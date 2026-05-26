const db = require("../config/db");

const sendError = (res, err, msg = "DB Error") => {
  console.error("[shipmentController]", err);
  return res.status(500).json({
    message: err?.sqlMessage || err?.message || msg,
    code: err?.code || "DB_ERROR"
  });
};

const validate = (body) => {
  const errs = [];
  if (!body.origin_city_id) errs.push("origin_city_id required");
  if (!body.destination_city_id) errs.push("destination_city_id required");
  if (!body.pcs || body.pcs <= 0) errs.push("pcs must be > 0");
  if (!body.weight || body.weight <= 0) errs.push("weight must be > 0");
  if (!body.mode) errs.push("mode required");
  if (!body.contents) errs.push("contents required");

  if (!body.sender?.name) errs.push("sender.name required");
  if (!body.sender?.phone) errs.push("sender.phone required");
  if (!body.receiver?.name) errs.push("receiver.name required");
  if (!body.receiver?.phone) errs.push("receiver.phone required");

  return errs;
};

const AWB_PREFIX = "1778";
const AWB_TOTAL_DIGITS = 12;
const AWB_SEQUENCE_DIGITS = AWB_TOTAL_DIGITS - AWB_PREFIX.length;

const generateNextAwb = (conn, done) => {
  const sql = `
    SELECT awb_number
    FROM shipments
    WHERE awb_number LIKE ?
      AND CHAR_LENGTH(awb_number) = ?
    ORDER BY awb_number DESC
    LIMIT 1
    FOR UPDATE
  `;

  conn.query(sql, [`${AWB_PREFIX}%`, AWB_TOTAL_DIGITS], (err, rows) => {
    if (err) return done(err);

    const lastAwb = rows?.[0]?.awb_number || null;
    const lastSequence = lastAwb ? Number(String(lastAwb).slice(AWB_PREFIX.length)) : 0;
    const nextSequence = lastSequence + 1;
    const nextSequenceStr = String(nextSequence).padStart(AWB_SEQUENCE_DIGITS, "0");

    if (nextSequenceStr.length > AWB_SEQUENCE_DIGITS) {
      return done(new Error("AWB sequence overflow for configured prefix"));
    }

    return done(null, `${AWB_PREFIX}${nextSequenceStr}`);
  });
};

const EVENT_TYPE_TO_STATUS = {
  picked: "Pickup and Despatch",
  transit: "In Transit",
  warehouse: "Delivered in Warehouse",
  out_delivery: "Out for Delivery",
  delivered: "Delivered",
  returned: "Returned",
  reschedule: "Reschedule Requested",
  missed: "Missed",
  refuse: "Refuse"
};

const STATUS_TO_EVENT_TYPE = Object.entries(EVENT_TYPE_TO_STATUS).reduce((acc, [k, v]) => {
  acc[v] = k;
  return acc;
}, {});

// Backward compatibility for historical typo used by some clients.
STATUS_TO_EVENT_TYPE.Delhivered = "delivered";

const normalizeStatusValue = (value) => {
  const raw = String(value || "").trim();
  if (!raw) return raw;
  const map = {
    delhiverd: "Delivered",
    delhivered: "Delivered",
    delivered: "Delivered",
    "out for delivery": "Out for Delivery",
    "pickup & despatch": "Pickup and Despatch",
    "pickup and despatch": "Pickup and Despatch",
    "in transit": "In Transit",
    "delivered in warehouse": "Delivered in Warehouse",
    returned: "Returned",
    "reschedule requested": "Reschedule Requested",
    missed: "Missed",
refuse: "Refuse",
  };
  return map[raw.toLowerCase()] || raw;
};

const buildGeo = (prefix, row) => ({
  country:
    row[`${prefix}_country_name`] ||
    row.country_name ||
    "",

  state:
    row[`${prefix}_state_name`] ||
    row.state_name ||
    "",

  district:
    row[`${prefix}_district_name`] ||
    row.district_name ||
    "",

  city:
    row[`${prefix}_city_name`] ||
    row.city_name ||
    "",

  country_id:
    row[`${prefix}_country_id`] ||
    row.country_id ||
    null,

  state_id:
    row[`${prefix}_state_id`] ||
    row.state_id ||
    null,

  district_id:
    row[`${prefix}_district_id`] ||
    row.district_id ||
    null,

  city_id:
    row[`${prefix}_city_id`] ||
    row.city_id ||
    null,
});
const toEventMeta = (row) => {

  const fromGeo = buildGeo("from", row);
  const toGeo = buildGeo("to", row);

  const base = {
    tracking_label: row.tracking_label || "",
  note: row.note || "",
  user_name: row.created_by || "",

  another_person: row.another_person || null,
  relation_name: row.relation_name || null,
  };

  if (row.event_type === "picked") {
    return {
      ...base,
      pickup_geo: fromGeo,
      pickup_location_name: row.branch_name || ""
    };
  }

  if (row.event_type === "transit") {
    return {
      ...base,
      transit_from_geo: fromGeo,
      transit_to_geo: toGeo,
      transit_location_name: row.branch_name || "",
      transit_hub_label: row.branch_name || ""
    };
  }

  if (row.event_type === "warehouse") {
    return {
      ...base,
      warehouse_geo: toGeo,
      warehouse_location_name: row.branch_name || ""
    };
  }

  if (row.event_type === "out_delivery") {
    return {
      ...base,
      out_for_delivery_geo: toGeo,
      out_for_delivery_location_name: row.branch_name || ""
    };
  }
  if (row.event_type === "missed") {
  return {
    ...base,
    missed_geo: toGeo,
    missed_location_name: row.branch_name || "",
    reason: row.note || ""
  };
}

if (row.event_type === "refuse") {
  return {
    ...base,
    refuse_geo: toGeo,
    refuse_location_name: row.branch_name || "",
    reason: row.note || ""
  };
}

  return base;
};
const mapShipmentEventRow = (row) => ({
  id: row.id,
  status: row.status || EVENT_TYPE_TO_STATUS[row.event_type] || "Pending",
  title: row.status || EVENT_TYPE_TO_STATUS[row.event_type] || "Tracking updated",
  detail: row.note || "",
  location: row.branch_name || "",
  occurred_at: row.event_time,
  meta: toEventMeta(row),
  created_by: row.created_by || null,
  event_type: row.event_type || null,
});

const fetchShipmentEventsByIds = (shipmentIds, done) => {

  if (!shipmentIds.length) {
    return done(null, {});
  }

  const sql = `
    SELECT
      se.*,

      -- NEW GEO (FROM)
      from_co.name AS from_country_name,
      from_st.name AS from_state_name,
      from_di.name AS from_district_name,
      from_ci.name AS from_city_name,

      -- NEW GEO (TO)
      to_co.name AS to_country_name,
      to_st.name AS to_state_name,
      to_di.name AS to_district_name,
      to_ci.name AS to_city_name,

      -- OLD GEO FALLBACK
      co.name AS country_name,
      st.name AS state_name,
      di.name AS district_name,
      ci.name AS city_name

    FROM shipment_events se

    -- FROM GEO
    LEFT JOIN countries from_co
      ON se.from_country_id = from_co.id

    LEFT JOIN states from_st
      ON se.from_state_id = from_st.id

    LEFT JOIN districts from_di
      ON se.from_district_id = from_di.id

    LEFT JOIN cities from_ci
      ON se.from_city_id = from_ci.id

    -- TO GEO
    LEFT JOIN countries to_co
      ON se.to_country_id = to_co.id

    LEFT JOIN states to_st
      ON se.to_state_id = to_st.id

    LEFT JOIN districts to_di
      ON se.to_district_id = to_di.id

    LEFT JOIN cities to_ci
      ON se.to_city_id = to_ci.id

    -- OLD LEGACY GEO SUPPORT
    LEFT JOIN countries co
      ON se.country_id = co.id

    LEFT JOIN states st
      ON se.state_id = st.id

    LEFT JOIN districts di
      ON se.district_id = di.id

    LEFT JOIN cities ci
      ON se.city_id = ci.id

    WHERE se.shipment_id IN (?)

    ORDER BY se.event_time ASC, se.id ASC
  `;

  db.query(sql, [shipmentIds], (err, rows) => {

    if (err) {
      return done(err);
    }

    const grouped = rows.reduce((acc, row) => {

      const key = Number(row.shipment_id);

      if (!acc[key]) {
        acc[key] = [];
      }

      acc[key].push(mapShipmentEventRow(row));

      return acc;

    }, {});

    return done(null, grouped);
  });
};

const fetchLegacyTrackingByIds = (shipmentIds, done) => {
  if (!shipmentIds.length) return done(null, {});
  const sql = `
    SELECT id, shipment_id, status, created_at
    FROM shipment_tracking
    WHERE shipment_id IN (?)
    ORDER BY created_at ASC, id ASC
  `;
  db.query(sql, [shipmentIds], (err, rows) => {
    if (err) return done(err);
    const grouped = rows.reduce((acc, row) => {
      const key = Number(row.shipment_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push({
        id: row.id,
        status: row.status || "Pending",
        title: row.status || "Tracking updated",
        detail: "",
        location: "",
        occurred_at: row.created_at,
        meta: {},
      });
      return acc;
    }, {});
    return done(null, grouped);
  });
};

const fetchShipmentEventsSingle = (shipmentId, done) => {
  fetchShipmentEventsByIds([shipmentId], (err, grouped) => {
    if (err) return done(err);
    return done(null, grouped[Number(shipmentId)] || []);
  });
};

const fetchRescheduleRequestsByShipmentIds = (shipmentIds, done) => {
  if (!shipmentIds.length) return done(null, {});
  const sql = `
    SELECT
      r.*,
      s.awb_number,
      receiver.name AS receiver_name,
      receiver.phone AS receiver_phone
    FROM shipment_reschedule_requests r
    INNER JOIN shipments s ON s.id = r.shipment_id
    LEFT JOIN shipment_addresses receiver
      ON receiver.shipment_id = r.shipment_id AND receiver.type = 'receiver'
    WHERE r.shipment_id IN (?)
    ORDER BY r.created_at DESC, r.id DESC
  `;
  db.query(sql, [shipmentIds], (err, rows) => {
    if (err) return done(err);
    const grouped = rows.reduce((acc, row) => {
      const key = Number(row.shipment_id);
      if (!acc[key]) acc[key] = [];
      acc[key].push({
        id: row.id,
        shipment_id: row.shipment_id,
        requested_date: row.requested_date,
        time_slot: row.time_slot || "",
        requested_time: row.requested_time || "",
        requested_by_email: row.requested_by_email || "",
        status: row.status || "Pending",
        requested_at: row.requested_at || row.created_at || null,
        created_at: row.created_at || null,
      });
      return acc;
    }, {});
    return done(null, grouped);
  });
};

const STATUS_FLAG_UPDATES = {
  "Product Placed": {
    product_placed_flag: 1
  },

  "Pickup and Despatch": {
    product_placed_flag: 1,
    pickup_completed_flag: 1
  },

  "In Transit": {
    product_placed_flag: 1,
    pickup_completed_flag: 1,
    in_transit_flag: 1
  },

  "Delivered in Warehouse": {
    product_placed_flag: 1,
    pickup_completed_flag: 1,
    in_transit_flag: 1,
    warehouse_reached_flag: 1
  },

  "Out for Delivery": {
  product_placed_flag: 1,
  pickup_completed_flag: 1,
  in_transit_flag: 1,
  warehouse_reached_flag: 1,
  out_for_delivery_flag: 1
},
"Missed": {
  product_placed_flag: 1,
  pickup_completed_flag: 1,
  in_transit_flag: 1,
  warehouse_reached_flag: 1,
  out_for_delivery_flag: 1
},

"Refuse": {
  product_placed_flag: 1,
  pickup_completed_flag: 1,
  in_transit_flag: 1,
  warehouse_reached_flag: 1,
  out_for_delivery_flag: 1
},
  "Delivered": {
  product_placed_flag: 1,
  pickup_completed_flag: 1,
  in_transit_flag: 1,
  warehouse_reached_flag: 1,
  out_for_delivery_flag: 1,
  delivered_flag: 1
},

  "Returned": {
    returned_flag: 1
  },

  "Reschedule Requested": {
    reschedule_flag: 1
  }
};


const syncShipmentStatusFromEvents = (shipmentId, done) => {
  const sql = `
    SELECT status
    FROM shipment_events
    WHERE shipment_id = ?
    ORDER BY event_time DESC, id DESC
    LIMIT 1
  `;
  db.query(sql, [shipmentId], (err, rows) => {
    if (err) return done(err);
    const nextStatus = normalizeStatusValue(rows?.[0]?.status || "Pending");
    const flagUpdates = STATUS_FLAG_UPDATES[nextStatus] || {};

const fields = ["status = ?"];
const values = [nextStatus];

Object.entries(flagUpdates).forEach(([key, value]) => {
  fields.push(`${key} = ?`);
  values.push(value);
});

values.push(shipmentId);

const updateSql = `
  UPDATE shipments
  SET ${fields.join(", ")}
  WHERE id = ?
`;

db.query(updateSql, values, (updErr) => {
  done(updErr, nextStatus);
});
  });
};

// 🔥 CREATE WITH TRANSACTION
exports.createShipment = (req, res) => {
  const errors = validate(req.body);
  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  const {
    origin_city_id,
    destination_city_id,
    shipment_date,
    expected_delivery_date,
    pcs,
    weight,
    mode,
    contents,
    declared_value = 0,
    remarks,
    return_details,
    reference_name,
    cust_ref_no,
    sl_no,
    sender,
    receiver
  } = req.body;

  const createdAt = new Date();
  db.getConnection((err, conn) => {
    if (err) return sendError(res, err);

    conn.beginTransaction((err) => {
      if (err) return sendError(res, err);

      generateNextAwb(conn, (awbErr, awb) => {
        if (awbErr) return conn.rollback(() => sendError(res, awbErr, "AWB generation failed"));

        const shipmentSql = `
          INSERT INTO shipments
          (awb_number, origin_city_id, destination_city_id, shipment_date, expected_delivery_date,
           pcs, weight, mode, contents, declared_value,
           remarks, return_details, cust_ref_no, sl_no,created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?)
        `;





        conn.query(shipmentSql, [
          awb,
          origin_city_id,
          destination_city_id,
          shipment_date,
          expected_delivery_date,
          pcs,
          weight,
          mode,
          contents,
          declared_value,
          remarks,
          return_details,
          cust_ref_no,
          sl_no,
          createdAt
        ], (err, result) => {
        if (err) return conn.rollback(() => sendError(res, err));

        const shipmentId = result.insertId;

        const addressSql = `
          INSERT INTO shipment_addresses
(shipment_id, type, person_type ,name, reference_name, address, pincode_id, city_id, district_id, state_id, country_id, phone, whatsapp, email)
VALUES ?
        `;

        const values = [
  [
    shipmentId,
    "sender",
    sender.person_type || sender.sender_type || "Person",
    sender.name,
    null, // sender no ref (optional)
    sender.address,
    sender.pincode_id,
    sender.city_id,
    sender.district_id,
    sender.state_id,
    sender.country_id,
    sender.phone,
    sender.whatsapp,
    sender.email
  ],
  [
    shipmentId,
    "receiver",
    receiver.person_type || receiver.receiver_type || "Person",
    receiver.name,
    receiver.reference_name || null, // ✅ THIS IS YOUR FIELD
    receiver.address,
    receiver.pincode_id,
    receiver.city_id,
    receiver.district_id,
    receiver.state_id,
    receiver.country_id,
    receiver.phone,
    receiver.whatsapp,
    receiver.email
  ]
];
        conn.query(addressSql, [values], (err2) => {
          if (err2) return conn.rollback(() => sendError(res, err2));

          conn.query(
  "INSERT INTO shipment_tracking (shipment_id, status ,created_at) VALUES (?, ?, ?)",
  [shipmentId, "Product Placed", createdAt],
  (err3) => {

    if (err3) {
      return conn.rollback(() => sendError(res, err3));
    }

    conn.query(
      `
      UPDATE shipments
      SET product_placed_flag = 1
      WHERE id = ?
      `,
      [shipmentId],
      (flagErr) => {

        if (flagErr) {
          return conn.rollback(() => sendError(res, flagErr));
        }

        conn.commit((err4) => {

          if (err4) {
            return conn.rollback(() => sendError(res, err4));
          }

          conn.release();

          res.json({
            message: "Shipment created",
            awb
          });

        });

      }
    );

  }
);
          });
        });
      });
    });
  });
};

// 🔥 GET ALL
exports.getAllShipments = (req, res) => {
  const sql = `
    SELECT 
      s.*,

     -- sender
      sender.name AS sender_name,
      sender.person_type AS sender_type,
      sender.phone AS sender_phone,
      sender.whatsapp AS sender_whatsapp,
      sender.whatsapp AS sender_whatsapp_no,
      sender.whatsapp AS sender_whatsapp_number,
      sender.email AS sender_email,
      sender.address AS sender_address,
      sender.state_id AS sender_state_id,
      sender.district_id AS sender_district_id,
      sender.city_id AS sender_city_id,
      sender.pincode_id AS sender_pincode_id,
      sender_city.name AS sender_city,

      -- receiver
      receiver.name AS receiver_name,
      receiver.person_type AS receiver_type,
      receiver.reference_name AS receiver_reference_name,
      receiver.phone AS receiver_phone,
      receiver.whatsapp AS receiver_whatsapp,
      receiver.email AS receiver_email,
      receiver.email AS receiver_from_email,
      receiver.email AS receiver_email_id,
      receiver.address AS receiver_address,
      receiver.state_id AS receiver_state_id,
      receiver.district_id AS receiver_district_id,
      receiver.city_id AS receiver_city_id,
      receiver.pincode_id AS receiver_pincode_id,
      receiver_city.name AS receiver_city

    FROM shipments s

    LEFT JOIN shipment_addresses sender 
      ON s.id = sender.shipment_id AND sender.type = 'sender'

    LEFT JOIN shipment_addresses receiver 
      ON s.id = receiver.shipment_id AND receiver.type = 'receiver'

    -- sender city
    LEFT JOIN cities sender_city
      ON sender.city_id = sender_city.id

    -- receiver city
    LEFT JOIN cities receiver_city
      ON receiver.city_id = receiver_city.id

    ORDER BY s.id DESC
  `;

  
  db.query(sql, (err, result) => {
    if (err) return sendError(res, err);
    const shipmentIds = result.map((row) => Number(row.id)).filter(Boolean);
    fetchShipmentEventsByIds(shipmentIds, (evErr, eventMap) => {
      if (evErr) return sendError(res, evErr);

      fetchLegacyTrackingByIds(shipmentIds, (legacyErr, legacyMap) => {
        if (legacyErr) return sendError(res, legacyErr);

        fetchRescheduleRequestsByShipmentIds(shipmentIds, (reqErr, requestMap) => {
          if (reqErr) return sendError(res, reqErr);

          const enriched = result.map((row) => ({
            ...row,
            tracking_events: eventMap[Number(row.id)]?.length
              ? eventMap[Number(row.id)]
              : (legacyMap[Number(row.id)] || []),
            schedule_requests: requestMap[Number(row.id)] || [],
          }));
          return res.json(enriched);
        });
      });
    });
  });
};

// 🔥 GET BY AWB
exports.getShipmentByAwb = (req, res) => {
  const { awb } = req.params;

  db.query("SELECT * FROM shipments WHERE awb_number = ?", [awb], (err, rows) => {
    if (err) return sendError(res, err);
    if (!rows.length) return res.status(404).json({ message: "Not found" });

    const shipment = rows[0];

    db.query("SELECT * FROM shipment_addresses WHERE shipment_id = ?", [shipment.id], (err2, addr) => {
      if (err2) return sendError(res, err2);

      db.query("SELECT * FROM shipment_tracking WHERE shipment_id = ?", [shipment.id], (err3, track) => {
        if (err3) return sendError(res, err3);

        fetchShipmentEventsSingle(shipment.id, (evErr, events) => {
          if (evErr) return sendError(res, evErr);

          const sender = addr.find(a => a.type === "sender");
          const receiver = addr.find(a => a.type === "receiver");

          res.json({
            shipment,
            sender,
            receiver,
            // Backward-compatible flattened keys for edit-form hydration
            sender_whatsapp: sender?.whatsapp ?? null,
            sender_email: sender?.email ?? null,
            receiver_whatsapp: receiver?.whatsapp ?? null,
            receiver_email: receiver?.email ?? null,
            receiver_reference_name: receiver?.reference_name ?? null,
            tracking: track,
            tracking_events: events.length
              ? events
              : track.map((t) => ({
                id: t.id,
                status: t.status || "Pending",
                title: t.status || "Tracking updated",
                detail: "",
                location: "",
                occurred_at: t.created_at,
                meta: {},
              })),
          });
        });
      });
    });
  });
};

exports.getShipmentEvents = (req, res) => {
  const shipmentId = Number(req.params.id);
  if (!shipmentId) return res.status(400).json({ message: "Invalid shipment id" });

  fetchShipmentEventsSingle(shipmentId, (err, events) => {
    if (err) return sendError(res, err);
    return res.json(events);
  });
};

exports.createShipmentEvent = (req, res) => {
  const shipmentId = Number(req.params.id);

  if (!shipmentId) {
    return res.status(400).json({
      message: "Invalid shipment id"
    });
  }

  const {
    event_type,
    status,

    // NEW GEO STRUCTURE
    from_country_id = null,
    from_state_id = null,
    from_district_id = null,
    from_city_id = null,

    to_country_id = null,
    to_state_id = null,
    to_district_id = null,
    to_city_id = null,

    // OLD FIELDS (BACKWARD COMPATIBILITY)
    country_id = null,
    state_id = null,
    district_id = null,
    city_id = null,
    another_person = null,
relation_name = null,
receiver_type = null,
    branch_name = null,
    tracking_label = null,
    note = null,
    event_time,
    created_by = null,
  } = req.body;

  if (!event_time) {
    return res.status(400).json({
      message: "event_time required"
    });
  }

  const normalizedStatus = normalizeStatusValue(status);

  const resolvedType =
    event_type || STATUS_TO_EVENT_TYPE[normalizedStatus];

  const resolvedStatus =
    normalizeStatusValue(
      normalizedStatus || EVENT_TYPE_TO_STATUS[event_type]
    );

  if (!resolvedType) {
    return res.status(400).json({
      message: "event_type required or valid status mapping required"
    });
  }

  if (!resolvedStatus) {
    return res.status(400).json({
      message: "status required or valid event_type mapping required"
    });
  }

  // BACKWARD COMPATIBILITY FALLBACKS
  // If frontend still sends old fields,
  // system will still work safely.

  const finalFromCountryId =
    from_country_id || country_id || null;

  const finalFromStateId =
    from_state_id || state_id || null;

  const finalFromDistrictId =
    from_district_id || district_id || null;

  const finalFromCityId =
    from_city_id || city_id || null;

  const finalToCountryId =
    to_country_id || country_id || null;

  const finalToStateId =
    to_state_id || state_id || null;

  const finalToDistrictId =
    to_district_id || district_id || null;

  const finalToCityId =
    to_city_id || city_id || null;

  const sql = `
    INSERT INTO shipment_events
    (
      shipment_id,
      event_type,
      status,

      from_country_id,
      from_state_id,
      from_district_id,
      from_city_id,

      to_country_id,
      to_state_id,
      to_district_id,
      to_city_id,

      branch_name,
      tracking_label,
      note,
      another_person,
      relation_name,
      event_time,
      created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    shipmentId,
    resolvedType,
    resolvedStatus,

    finalFromCountryId,
    finalFromStateId,
    finalFromDistrictId,
    finalFromCityId,

    finalToCountryId,
    finalToStateId,
    finalToDistrictId,
    finalToCityId,

    branch_name,
    tracking_label,
    note,
    receiver_type === "Another Person"
    ? another_person
    : null,

    relation_name || "Self",
    event_time,
    created_by
  ];

  const receiverSql = `
  UPDATE shipment_addresses
  SET
    another_person = ?,
    relation_name = ?
  WHERE shipment_id = ?
  AND type = 'receiver'
`;

db.query(
  receiverSql,
  [
    receiver_type === "Another Person"
      ? another_person
      : null,

    relation_name || "Self",

    shipmentId
  ],
  (receiverErr) => {

    if (receiverErr) {
      return sendError(res, receiverErr);
    }

    db.query(sql, values, (err, result) => {

      if (err) {
        return sendError(res, err);
      }

      syncShipmentStatusFromEvents(
        shipmentId,
        (syncErr, statusAfterSync) => {

          if (syncErr) {
            return sendError(res, syncErr);
          }

          return res.json({
            message: "Shipment event created",
            id: result.insertId,
            shipment_status: statusAfterSync
          });

        }
      );

    });

  }
);
};

exports.updateShipmentEvent = (req, res) => {

  const shipmentId = Number(req.params.id);
  const eventId = Number(req.params.eventId);

  if (!shipmentId || !eventId) {
    return res.status(400).json({
      message: "Invalid shipment id/event id"
    });
  }

  const {
    event_type,
    status,

    // NEW GEO STRUCTURE
    from_country_id = null,
    from_state_id = null,
    from_district_id = null,
    from_city_id = null,

    to_country_id = null,
    to_state_id = null,
    to_district_id = null,
    to_city_id = null,

    // OLD FIELDS (BACKWARD COMPATIBILITY)
    country_id = null,
    state_id = null,
    district_id = null,
    city_id = null,

    branch_name = null,
    tracking_label = null,
    note = null,
    event_time = null,
    created_by = null,

  } = req.body;

  const normalizedStatus = normalizeStatusValue(status);

  const resolvedType =
    event_type || STATUS_TO_EVENT_TYPE[normalizedStatus];

  const resolvedStatus =
    normalizeStatusValue(
      normalizedStatus || EVENT_TYPE_TO_STATUS[event_type]
    );

  if (!resolvedType) {
    return res.status(400).json({
      message: "event_type required or valid status mapping required"
    });
  }

  if (!resolvedStatus) {
    return res.status(400).json({
      message: "status required or valid event_type mapping required"
    });
  }

  // SAFE FALLBACK SUPPORT
  // Old frontend still works

  const finalFromCountryId =
    from_country_id || country_id || null;

  const finalFromStateId =
    from_state_id || state_id || null;

  const finalFromDistrictId =
    from_district_id || district_id || null;

  const finalFromCityId =
    from_city_id || city_id || null;

  const finalToCountryId =
    to_country_id || country_id || null;

  const finalToStateId =
    to_state_id || state_id || null;

  const finalToDistrictId =
    to_district_id || district_id || null;

  const finalToCityId =
    to_city_id || city_id || null;

  const sql = `
    UPDATE shipment_events

    SET
      event_type = ?,
      status = ?,

      from_country_id = ?,
      from_state_id = ?,
      from_district_id = ?,
      from_city_id = ?,

      to_country_id = ?,
      to_state_id = ?,
      to_district_id = ?,
      to_city_id = ?,

      branch_name = ?,
      tracking_label = ?,
      note = ?,

      event_time = COALESCE(?, event_time),

      created_by = ?

    WHERE id = ? AND shipment_id = ?
  `;

  const values = [

    resolvedType,
    resolvedStatus,

    finalFromCountryId,
    finalFromStateId,
    finalFromDistrictId,
    finalFromCityId,

    finalToCountryId,
    finalToStateId,
    finalToDistrictId,
    finalToCityId,

    branch_name,
    tracking_label,
    note,
    event_time,

    created_by,

    eventId,
    shipmentId
  ];

  db.query(sql, values, (err, result) => {

    if (err) {
      return sendError(res, err);
    }

    if (!result.affectedRows) {
      return res.status(404).json({
        message: "Shipment event not found"
      });
    }

    syncShipmentStatusFromEvents(
      shipmentId,
      (syncErr, statusAfterSync) => {

        if (syncErr) {
          return sendError(res, syncErr);
        }

        return res.json({
          message: "Shipment event updated",
          id: eventId,
          shipment_status: statusAfterSync
        });
      }
    );
  });
};

exports.deleteShipmentEvent = (req, res) => {
  const shipmentId = Number(req.params.id);
  const eventId = Number(req.params.eventId);
  if (!shipmentId || !eventId) return res.status(400).json({ message: "Invalid shipment id/event id" });

  db.query(
    "DELETE FROM shipment_events WHERE id = ? AND shipment_id = ?",
    [eventId, shipmentId],
    (err, result) => {
      if (err) return sendError(res, err);
      if (!result.affectedRows) return res.status(404).json({ message: "Shipment event not found" });
      syncShipmentStatusFromEvents(shipmentId, (syncErr, statusAfterSync) => {
        if (syncErr) return sendError(res, syncErr);
        return res.json({ message: "Shipment event deleted", id: eventId, shipment_status: statusAfterSync });
      });
    }
  );
};

exports.updateShipment = (req, res) => {
  const { id } = req.params;
  const errors = validate(req.body);
  if (errors.length) {
    return res.status(400).json({ message: "Validation failed", errors });
  }

  const {
    origin_city_id,
    destination_city_id,
    shipment_date,expected_delivery_date,    pcs,
    weight,
    mode,
    contents,
    declared_value = 0,
    remarks,
    return_details,
    cust_ref_no,
    sl_no,
    status,
    sender,
    receiver
  } = req.body;
  
  db.getConnection((err, conn) => {
    if (err) return sendError(res, err);

    conn.beginTransaction((txErr) => {
      if (txErr) {
        conn.release();
        return sendError(res, txErr);
      }

      const shipmentSql = `
        UPDATE shipments
        SET origin_city_id = ?,
            destination_city_id = ?,
            shipment_date = ?,expected_delivery_date = ?,            pcs = ?,
            weight = ?,
            mode = ?,
            contents = ?,
            declared_value = ?,
            remarks = ?,
            return_details = ?,
            cust_ref_no = ?,
            sl_no = ?
        WHERE id = ?
      `;

      conn.query(
        shipmentSql,
        [
          origin_city_id,
          destination_city_id,
          shipment_date,    expected_delivery_date,      pcs,
          weight,
          mode,
          contents,
          declared_value,
          remarks,
          return_details,
          cust_ref_no,
          sl_no,
          id,
        ],
        (shipmentErr, shipmentResult) => {
          if (shipmentErr) return conn.rollback(() => { conn.release(); sendError(res, shipmentErr); });
          if (!shipmentResult.affectedRows) {
            return conn.rollback(() => {
              conn.release();
              res.status(404).json({ message: "Shipment not found" });
            });
          }

          const updateAddress = (type, addressData, done) => {
            const addressSql = `
              UPDATE shipment_addresses
              SET  person_type = ?,
                   name = ?,
                  reference_name = ?,
                  address = ?,
                  pincode_id = ?,
                  city_id = ?,
                  district_id = ?,
                  state_id = ?,
                  country_id = ?,
                  phone = ?,
                  whatsapp = ?,
                  email = ?
              WHERE shipment_id = ? AND type = ?
            `;

            const params = [
              addressData?.person_type || "Person",
              addressData?.name || null,
              addressData?.reference_name || null,
              addressData?.address || null,
              addressData?.pincode_id || null,
              addressData?.city_id || null,
              addressData?.district_id || null,
              addressData?.state_id || null,
              addressData?.country_id || null,
              addressData?.phone || null,
              addressData?.whatsapp || null,
              addressData?.email || null,
              id,
              type,
            ];

            conn.query(addressSql, params, (addressErr, addressResult) => {
              if (addressErr) return done(addressErr);

              if (addressResult.affectedRows > 0) return done();

              const insertAddressSql = `
                INSERT INTO shipment_addresses
                (shipment_id, type,person_type, name, reference_name, address, pincode_id, city_id, district_id, state_id, country_id, phone, whatsapp, email)
                VALUES (?, ?,? ,?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `;

              conn.query(
                insertAddressSql,
                [
                  id,
                  type,
                   addressData?.person_type || "Person",
                  addressData?.name || null,
                  addressData?.reference_name || null,
                  addressData?.address || null,
                  addressData?.pincode_id || null,
                  addressData?.city_id || null,
                  addressData?.district_id || null,
                  addressData?.state_id || null,
                  addressData?.country_id || null,
                  addressData?.phone || null,
                  addressData?.whatsapp || null,
                  addressData?.email || null,
                ],
                done
              );
            });
          };

          updateAddress("sender", sender, (senderErr) => {
            if (senderErr) return conn.rollback(() => { conn.release(); sendError(res, senderErr); });

            updateAddress("receiver", receiver, (receiverErr) => {
              if (receiverErr) return conn.rollback(() => { conn.release(); sendError(res, receiverErr); });
               const createdAt = new Date();
              if (status) {
                const normalizedStatus = normalizeStatusValue(status);
                const flagUpdates = STATUS_FLAG_UPDATES[normalizedStatus] || {};
                const fields = ["status = ?"];
                const values = [normalizedStatus];

                Object.entries(flagUpdates).forEach(([key, value]) => {
                  fields.push(`${key} = ?`);
                  values.push(value);
                });
                values.push(id);

                conn.query(
                  "INSERT INTO shipment_tracking (shipment_id, status,created_at) VALUES (?, ?, ?)",
                  [id, normalizedStatus, createdAt],
                  (trackingErr) => {
                    if (trackingErr) return conn.rollback(() => { conn.release(); sendError(res, trackingErr); });

                    conn.query(
                      `UPDATE shipments SET ${fields.join(", ")} WHERE id = ?`,
                      values,
                      (statusErr) => {
                        if (statusErr) return conn.rollback(() => { conn.release(); sendError(res, statusErr); });
                        conn.commit((commitErr) => {
                          if (commitErr) return conn.rollback(() => { conn.release(); sendError(res, commitErr); });
                          conn.release();
                          res.json({ message: "Shipment updated", id: Number(id) });
                        });
                      }
                    );
                  }
                );
                return;
              }

              conn.commit((commitErr) => {
                if (commitErr) return conn.rollback(() => { conn.release(); sendError(res, commitErr); });
                conn.release();
                res.json({ message: "Shipment updated", id: Number(id) });
              });
            });
          });
        }
      );
    });
  });
};

exports.deleteShipment = (req, res) => {
  const shipmentId = Number(req.params.id);
  if (!shipmentId) {
    return res.status(400).json({ message: "Invalid shipment id" });
  }

  db.getConnection((connErr, conn) => {
    if (connErr) return sendError(res, connErr);

    conn.beginTransaction((txErr) => {
      if (txErr) {
        conn.release();
        return sendError(res, txErr);
      }

      conn.query("SELECT id FROM shipments WHERE id = ?", [shipmentId], (checkErr, rows) => {
        if (checkErr) {
          return conn.rollback(() => {
            conn.release();
            sendError(res, checkErr);
          });
        }
        if (!rows.length) {
          return conn.rollback(() => {
            conn.release();
            res.status(404).json({ message: "Shipment not found" });
          });
        }

        conn.query("DELETE FROM shipment_events WHERE shipment_id = ?", [shipmentId], (eventErr) => {
          if (eventErr) {
            return conn.rollback(() => {
              conn.release();
              sendError(res, eventErr);
            });
          }

          conn.query("DELETE FROM shipment_tracking WHERE shipment_id = ?", [shipmentId], (trackingErr) => {
            if (trackingErr) {
              return conn.rollback(() => {
                conn.release();
                sendError(res, trackingErr);
              });
            }

            conn.query("DELETE FROM shipment_addresses WHERE shipment_id = ?", [shipmentId], (addrErr) => {
              if (addrErr) {
                return conn.rollback(() => {
                  conn.release();
                  sendError(res, addrErr);
                });
              }

              conn.query("DELETE FROM shipment_reschedule_requests WHERE shipment_id = ?", [shipmentId], (resErr) => {
                if (resErr) {
                  return conn.rollback(() => {
                    conn.release();
                    sendError(res, resErr);
                  });
                }

                conn.query("DELETE FROM shipments WHERE id = ?", [shipmentId], (shipErr, result) => {
                  if (shipErr) {
                    return conn.rollback(() => {
                      conn.release();
                      sendError(res, shipErr);
                    });
                  }
                  if (!result.affectedRows) {
                    return conn.rollback(() => {
                      conn.release();
                      res.status(404).json({ message: "Shipment not found" });
                    });
                  }

                  conn.commit((commitErr) => {
                    if (commitErr) {
                      return conn.rollback(() => {
                        conn.release();
                        sendError(res, commitErr);
                      });
                    }
                    conn.release();
                    return res.json({ message: "Shipment deleted", id: shipmentId });
                  });
                });
              });
            });
          });
        });
      });
    });
  });
};

exports.createRescheduleRequest = (req, res) => {
  const shipmentId = Number(req.params.id);

  if (!shipmentId) {
    return res.status(400).json({
      message: "Invalid shipment id"
    });
  }

  const {
    requested_date,
    time_slot,
    requested_time,
    requested_by_email
  } = req.body;

  if (!requested_date) {
    return res.status(400).json({
      message: "requested_date required"
    });
  }
  const createdAt = new Date();
  // 1. CHECK SHIPMENT EXISTS
  db.query(
    "SELECT id FROM shipments WHERE id = ?",
    [shipmentId],
    (checkErr, shipmentRows) => {

      if (checkErr) return sendError(res, checkErr);

      if (!shipmentRows.length) {
        return res.status(404).json({
          message: "Shipment not found"
        });
      }

      // 2. INSERT RESCHEDULE REQUEST
     const insertRequestSql = `
  INSERT INTO shipment_reschedule_requests
  (
    shipment_id,
    requested_date,
    time_slot,
    requested_time,
    requested_by_email,
    created_at
  )
  VALUES (?, ?, ?, ?, ?, ?)
`;

      db.query(
        insertRequestSql,
        [
          shipmentId,
          requested_date,
          time_slot || null,
           requested_time || null,
          requested_by_email || null,
          createdAt
        ],
        (insertErr, result) => {

          if (insertErr) return sendError(res, insertErr);

          // 3. INSERT TIMELINE EVENT
          const eventSql = `
            INSERT INTO shipment_events
            (
              shipment_id,
              event_type,
              status,
              note,
              event_time
            )
            VALUES (?, ?, ?, ?,?)
          `;

          const note =
  `Customer requested delivery on ${requested_date}` +
  (time_slot ? ` (${time_slot})` : "") +
  (requested_time ? ` at ${requested_time}` : "");

          db.query(
            eventSql,
            [
              shipmentId,
              "reschedule",
              "Reschedule Requested",
              note,
              new Date()
            ],
            (eventErr) => {

              if (eventErr) return sendError(res, eventErr);

              // 4. SYNC SHIPMENT STATUS
              syncShipmentStatusFromEvents(
                shipmentId,
                (syncErr, shipmentStatus) => {

                  if (syncErr) {
                    return sendError(res, syncErr);
                  }

                  return res.json({
                    message: "Reschedule request created",
                    request_id: result.insertId,
                    shipment_status: shipmentStatus
                  });
                }
              );
            }
          );
        }
      );
    }
  );
};

exports.getAllRescheduleRequests = (req, res) => {
  const sql = `
    SELECT
      r.*,
      s.awb_number,
      s.shipment_date,
      s.mode,
      sender.name AS sender_name,
      receiver.name AS receiver_name,
      receiver.phone AS receiver_phone
    FROM shipment_reschedule_requests r
    INNER JOIN shipments s ON s.id = r.shipment_id
    LEFT JOIN shipment_addresses sender
      ON sender.shipment_id = s.id AND sender.type = 'sender'
    LEFT JOIN shipment_addresses receiver
      ON receiver.shipment_id = s.id AND receiver.type = 'receiver'
    ORDER BY r.created_at DESC, r.id DESC
  `;

  db.query(sql, (err, rows) => {
    if (err) return sendError(res, err);
    const payload = rows.map((row) => ({
      id: row.id,
      shipment_id: row.shipment_id,
      awb_number: row.awb_number,
      shipment_date: row.shipment_date,
      mode: row.mode,
      sender_name: row.sender_name || "",
      receiver_name: row.receiver_name || "",
      receiver_phone: row.receiver_phone || "",
      requested_date: row.requested_date,
      time_slot: row.time_slot || "",
      requested_time: row.requested_time || "",
      requested_by_email: row.requested_by_email || "",
      status: row.status || "Pending",
      requested_at: row.requested_at || row.created_at || null,
      created_at: row.created_at || null,
    }));
    return res.json(payload);
  });
};

exports.updateRescheduleRequestStatus = (req, res) => {
  const requestId = Number(req.params.requestId);
  const nextStatusRaw = String(req.body?.status || "").trim();
  const statusMap = {
    pending: "Pending",
    approved: "Accepted",
    accepted: "Accepted",
    rejected: "Rejected",
  };
  const nextStatus = statusMap[nextStatusRaw.toLowerCase()];

  if (!requestId) return res.status(400).json({ message: "Invalid request id" });
  if (!nextStatus) return res.status(400).json({ message: "Invalid status. Use Pending/Accepted/Rejected." });

  const updateSql = `
    UPDATE shipment_reschedule_requests
    SET status = ?
    WHERE id = ?
  `;

  db.query(updateSql, [nextStatus, requestId], (updErr, updResult) => {
    if (updErr) return sendError(res, updErr);
    if (!updResult.affectedRows) return res.status(404).json({ message: "Reschedule request not found" });
    return res.json({ message: "Reschedule request status updated", id: requestId, status: nextStatus });
  });
};
