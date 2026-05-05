const db = require("../config/db");

// 🔒 standard error handler (fixes your crash)
const sendError = (res, err) => {
  console.error("[pincodeController]", err);
  return res.status(500).json({
    message: err?.sqlMessage || err?.message || "DB Error",
    code: err?.code || "DB_ERROR"
  });
};

// 🔥 CREATE
exports.createPincode = (req, res) => {
  const { pincode, location, city, state_id, district_id } = req.body;

  db.query(
    "INSERT INTO pincodes (pincode, location, city, state_id, district_id) VALUES (?, ?, ?, ?, ?)",
    [pincode, location, city, state_id, district_id],
    (err) => {
      if (err) return sendError(res, err);
      res.json({ message: "Pincode added" });
    }
  );
};

// 🔥 GET ALL (UI ready)
exports.getPincodes = (req, res) => {
  const sql = `
    SELECT 
      p.id,
      p.pincode,
      p.location,
      p.city,
      p.state_id,
      p.district_id,
      p.status,
      c.name AS city_name,
      d.name AS district_name,
      s.name AS state_name,
      co.name AS country_name
    FROM pincodes p
    LEFT JOIN cities c ON p.city = c.id
    LEFT JOIN districts d ON p.district_id = d.id
    LEFT JOIN states s ON p.state_id = s.id
    LEFT JOIN countries co ON s.country_id = co.id
  `;

  db.query(sql, (err, result) => {
    if (err) return sendError(res, err);
    res.json(result);
  });
};

// 🔥 AUTOFILL (IMPORTANT FOR FRONTEND)
exports.getByPincode = (req, res) => {
  const sql = `
    SELECT 
      p.*,
      c.name AS city_name,
      d.name AS district_name,
      s.name AS state_name,
      co.name AS country_name
    FROM pincodes p
    LEFT JOIN cities c ON p.city = c.id
    LEFT JOIN districts d ON p.district_id = d.id
    LEFT JOIN states s ON p.state_id = s.id
    LEFT JOIN countries co ON s.country_id = co.id
    WHERE p.pincode = ?
    LIMIT 1
  `;

  db.query(sql, [req.params.pincode], (err, result) => {
    if (err) return sendError(res, err);
    if (!result.length) {
      return res.status(404).json({ message: "Pincode not found" });
    }
    res.json(result[0]);
  });
};

// 🔥 UPDATE
exports.updatePincode = (req, res) => {
  const { pincode, location, city, state_id, district_id, status } = req.body;

  db.query(
    "UPDATE pincodes SET pincode=?, location=?, city=?, state_id=?, district_id=?, status=? WHERE id=?",
    [pincode, location, city, state_id, district_id, status || "Active", req.params.id],
    (err) => {
      if (err) return sendError(res, err);
      res.json({ message: "Pincode updated" });
    }
  );
};

// 🔥 DELETE
exports.deletePincode = (req, res) => {
  db.query(
    "DELETE FROM pincodes WHERE id=?",
    [req.params.id],
    (err) => {
      if (err) return sendError(res, err);
      res.json({ message: "Pincode deleted" });
    }
  );
};