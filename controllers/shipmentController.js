const db = require("../config/db");

// 🔥 CREATE SHIPMENT
exports.createShipment = (req, res) => {
  const {
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

    sender,
    receiver
  } = req.body;

  // STEP 1 → insert shipment
  const shipmentSql = `
    INSERT INTO shipments
    (awb_number, origin_city_id, destination_city_id, shipment_date,
     pcs, weight, mode, contents, declared_value,
     remarks, return_details, cust_ref_no, sl_no)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const awb = "AWB" + Date.now();

  db.query(
    shipmentSql,
    [
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
    ],
    (err, result) => {
      if (err) return res.status(500).json(err);

      const shipmentId = result.insertId;

      // STEP 2 → insert addresses
      const addressSql = `
        INSERT INTO shipment_addresses
        (shipment_id, type, name, address, pincode_id, city_id, district_id, state_id, country_id, phone, whatsapp, email)
        VALUES ?
      `;

      const values = [
        [
          shipmentId,
          "sender",
          sender.name,
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

      db.query(addressSql, [values], (err2) => {
        if (err2) return res.status(500).json(err2);

        // STEP 3 → tracking entry
        const trackSql = `
          INSERT INTO shipment_tracking (shipment_id, status)
          VALUES (?, ?)
        `;

        db.query(trackSql, [shipmentId, "Product Placed"], (err3) => {
          if (err3) return res.status(500).json(err3);

          res.json({
            message: "Shipment created successfully",
            awb
          });
        });
      });
    }
  );
};

// 🔥 GET ALL
exports.getAllShipments = (req, res) => {
  db.query("SELECT * FROM shipments", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
};