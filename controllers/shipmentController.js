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
  returned: "Returned",
  reschedule: "Reschedule Requested",
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

  const createdAt = new Date();
  db.getConnection((err, conn) => {
    if (err) return sendError(res, err);

    conn.beginTransaction((err) => {
      if (err) return sendError(res, err);

      generateNextAwb(conn, (awbErr, awb) => {
        if (awbErr) return conn.rollback(() => sendError(res, awbErr, "AWB generation failed"));

        const shipmentSql = `
          INSERT INTO shipments
          (awb_number, origin_city_id, destination_city_id, shipment_date,
           pcs, weight, mode, contents, declared_value,
           remarks, return_details, cust_ref_no, sl_no,created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,  ?, ?, ?)
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
          sl_no,
          createdAt
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
            "INSERT INTO shipment_tracking (shipment_id, status ,created_at) VALUES (?, ?, ?)",
            [shipmentId, "Product Placed",createdAt],
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
               const createdAt = new Date();
              if (status) {
                conn.query(
                  "INSERT INTO shipment_tracking (shipment_id, status,created_at) VALUES (?, ?, ?)",
                  [id, status ,createdAt],
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
            VALUES (?, ?, ?, ?, ?)
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
