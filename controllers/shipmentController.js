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
      sender.address AS sender_address,
      sender.state_id AS sender_state_id,
      sender.district_id AS sender_district_id,
      sender.city_id AS sender_city_id,
      sender.pincode_id AS sender_pincode_id,

      -- receiver
      receiver.name AS receiver_name,
      receiver.phone AS receiver_phone,
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
    res.json(result);
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

        res.json({
          shipment,
          sender: addr.find(a => a.type === "sender"),
          receiver: addr.find(a => a.type === "receiver"),
          tracking: track
        });
      });
    });
  });
};
