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

const EVENT_TYPE_TO_STATUS = {
  picked: "Pickup and Despatch",
  transit: "In Transit",
  warehouse: "Delivered in Warehouse",
  out_delivery: "Out for Delivery",
  returned: "Returned",
};

const STATUS_TO_EVENT_TYPE = Object.entries(EVENT_TYPE_TO_STATUS).reduce((acc, [k, v]) => {
  acc[v] = k;
  return acc;
}, {});

const toEventMeta = (row) => {
  const geo = {
    country: row.country_name || "",
    state: row.state_name || "",
    district: row.district_name || "",
    city: row.city_name || "",
  };

  const base = {
    tracking_label: row.tracking_label || "",
    note: row.note || "",
    user_name: row.created_by || "",
  };

  if (row.event_type === "picked") return { ...base, pickup_geo: geo, pickup_location_name: row.branch_name || "" };
  if (row.event_type === "transit") return { ...base, transit_from_geo: geo, transit_to_geo: geo, transit_location_name: row.branch_name || "", transit_hub_label: row.branch_name || "" };
  if (row.event_type === "warehouse") return { ...base, warehouse_geo: geo, warehouse_location_name: row.branch_name || "" };
  if (row.event_type === "out_delivery") return { ...base, out_for_delivery_geo: geo, out_for_delivery_location_name: row.branch_name || "" };
  if (row.event_type === "returned") return { ...base, return_geo: geo, return_pickup_location_name: row.branch_name || "", source: row.branch_name || "", reason: row.note || "", return_type: "Rejected & Return" };
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
  if (!shipmentIds.length) return done(null, {});
  const sql = `
    SELECT
      se.*,
      co.name AS country_name,
      st.name AS state_name,
      di.name AS district_name,
      ci.name AS city_name
    FROM shipment_events se
    LEFT JOIN countries co ON se.country_id = co.id
    LEFT JOIN states st ON se.state_id = st.id
    LEFT JOIN districts di ON se.district_id = di.id
    LEFT JOIN cities ci ON se.city_id = ci.id
    WHERE se.shipment_id IN (?)
    ORDER BY se.event_time ASC, se.id ASC
  `;

  db.query(sql, [shipmentIds], (err, rows) => {
    if (err) return done(err);
    const grouped = rows.reduce((acc, row) => {
      const key = Number(row.shipment_id);
      if (!acc[key]) acc[key] = [];
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
    const nextStatus = rows?.[0]?.status || "Pending";
    db.query(
      "UPDATE shipments SET status = ? WHERE id = ?",
      [nextStatus, shipmentId],
      (updErr) => done(updErr, nextStatus)
    );
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

  const awb = "AWB" + Date.now();

  db.getConnection((err, conn) => {
    if (err) return sendError(res, err);

    conn.beginTransaction((err) => {
      if (err) return sendError(res, err);

      const shipmentSql = `
        INSERT INTO shipments
        (awb_number, origin_city_id, destination_city_id, shipment_date,
         pcs, weight, mode, contents, declared_value,
         remarks, return_details, cust_ref_no, sl_no)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?)
      `;

      conn.query(shipmentSql, [
        awb,
        origin_city_id,
        destination_city_id,
        shipment_date,
        pcs,
        weight,
        mode,
        contents,
        declared_value,
        remarks,
        return_details,
        cust_ref_no,
        sl_no
      ], (err, result) => {
        if (err) return conn.rollback(() => sendError(res, err));

        const shipmentId = result.insertId;

        const addressSql = `
          INSERT INTO shipment_addresses
(shipment_id, type, name, reference_name, address, pincode_id, city_id, district_id, state_id, country_id, phone, whatsapp, email)
VALUES ?
        `;

        const values = [
  [
    shipmentId,
    "sender",
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
            "INSERT INTO shipment_tracking (shipment_id, status) VALUES (?, ?)",
            [shipmentId, "Product Placed"],
            (err3) => {
              if (err3) return conn.rollback(() => sendError(res, err3));

              conn.commit((err4) => {
                if (err4) return conn.rollback(() => sendError(res, err4));

                conn.release();
                res.json({ message: "Shipment created", awb });
              });
            }
          );
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
      

      -- receiver
      receiver.name AS receiver_name,
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
      receiver.pincode_id AS receiver_pincode_id

    FROM shipments s

    LEFT JOIN shipment_addresses sender 
      ON s.id = sender.shipment_id AND sender.type = 'sender'

    LEFT JOIN shipment_addresses receiver 
      ON s.id = receiver.shipment_id AND receiver.type = 'receiver'

    ORDER BY s.id DESC
  `;

  db.query(sql, (err, result) => {
    if (err) return sendError(res, err);
    const shipmentIds = result.map((row) => Number(row.id)).filter(Boolean);
    fetchShipmentEventsByIds(shipmentIds, (evErr, eventMap) => {
      if (evErr) return sendError(res, evErr);

      fetchLegacyTrackingByIds(shipmentIds, (legacyErr, legacyMap) => {
        if (legacyErr) return sendError(res, legacyErr);

        const enriched = result.map((row) => ({
          ...row,
          tracking_events: eventMap[Number(row.id)]?.length
            ? eventMap[Number(row.id)]
            : (legacyMap[Number(row.id)] || []),
        }));
        return res.json(enriched);
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
  if (!shipmentId) return res.status(400).json({ message: "Invalid shipment id" });

  const {
    event_type,
    status,
    country_id = null,
    state_id = null,
    district_id = null,
    city_id = null,
    branch_name = null,
    tracking_label = null,
    note = null,
    event_time,
    created_by = null,
  } = req.body;

  if (!event_time) return res.status(400).json({ message: "event_time required" });
  const resolvedType = event_type || STATUS_TO_EVENT_TYPE[status];
  const resolvedStatus = status || EVENT_TYPE_TO_STATUS[event_type];
  if (!resolvedType) return res.status(400).json({ message: "event_type required or valid status mapping required" });
  if (!resolvedStatus) return res.status(400).json({ message: "status required or valid event_type mapping required" });

  const sql = `
    INSERT INTO shipment_events
    (shipment_id, event_type, status, country_id, state_id, district_id, city_id, branch_name, tracking_label, note, event_time, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  db.query(
    sql,
    [shipmentId, resolvedType, resolvedStatus, country_id, state_id, district_id, city_id, branch_name, tracking_label, note, event_time, created_by],
    (err, result) => {
      if (err) return sendError(res, err);
      syncShipmentStatusFromEvents(shipmentId, (syncErr, statusAfterSync) => {
        if (syncErr) return sendError(res, syncErr);
        return res.json({ message: "Shipment event created", id: result.insertId, shipment_status: statusAfterSync });
      });
    }
  );
};

exports.updateShipmentEvent = (req, res) => {
  const shipmentId = Number(req.params.id);
  const eventId = Number(req.params.eventId);
  if (!shipmentId || !eventId) return res.status(400).json({ message: "Invalid shipment id/event id" });

  const {
    event_type,
    status,
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

  const resolvedType = event_type || STATUS_TO_EVENT_TYPE[status];
  const resolvedStatus = status || EVENT_TYPE_TO_STATUS[event_type];
  if (!resolvedType) return res.status(400).json({ message: "event_type required or valid status mapping required" });
  if (!resolvedStatus) return res.status(400).json({ message: "status required or valid event_type mapping required" });

  const sql = `
    UPDATE shipment_events
    SET event_type = ?, status = ?, country_id = ?, state_id = ?, district_id = ?, city_id = ?, branch_name = ?, tracking_label = ?, note = ?, event_time = COALESCE(?, event_time), created_by = ?
    WHERE id = ? AND shipment_id = ?
  `;
  db.query(
    sql,
    [resolvedType, resolvedStatus, country_id, state_id, district_id, city_id, branch_name, tracking_label, note, event_time, created_by, eventId, shipmentId],
    (err, result) => {
      if (err) return sendError(res, err);
      if (!result.affectedRows) return res.status(404).json({ message: "Shipment event not found" });
      syncShipmentStatusFromEvents(shipmentId, (syncErr, statusAfterSync) => {
        if (syncErr) return sendError(res, syncErr);
        return res.json({ message: "Shipment event updated", id: eventId, shipment_status: statusAfterSync });
      });
    }
  );
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
    shipment_date,    pcs,
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
            shipment_date = ?,            pcs = ?,
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
          shipment_date,          pcs,
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
              SET name = ?,
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
                (shipment_id, type, name, reference_name, address, pincode_id, city_id, district_id, state_id, country_id, phone, whatsapp, email)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              `;

              conn.query(
                insertAddressSql,
                [
                  id,
                  type,
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

              if (status) {
                conn.query(
                  "INSERT INTO shipment_tracking (shipment_id, status) VALUES (?, ?)",
                  [id, status],
                  (trackingErr) => {
                    if (trackingErr) return conn.rollback(() => { conn.release(); sendError(res, trackingErr); });

                    conn.commit((commitErr) => {
                      if (commitErr) return conn.rollback(() => { conn.release(); sendError(res, commitErr); });
                      conn.release();
                      res.json({ message: "Shipment updated", id: Number(id) });
                    });
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

