const db = require("../config/db");

const sendError = (res, err) => {
  console.error("[districtController]", err);
  return res.status(500).json({
    message: err?.sqlMessage || err?.message || "DB Error",
    code: err?.code || "DB_ERROR"
  });
};

// 🔥 GET ALL DISTRICTS (with state + country)
exports.getDistricts = (req, res) => {
  const sql = `
    SELECT 
      d.id,
      d.name,
      d.state_id,
      d.status,
      s.name AS state_name,
      c.name AS country_name
    FROM districts d
    LEFT JOIN states s ON d.state_id = s.id
    LEFT JOIN countries c ON s.country_id = c.id
  `;

  db.query(sql, (err, result) => {
    if (err) return sendError(res, err);
    res.json(result);
  });
};

// 🔥 GET DISTRICTS BY STATE (with state + country)
exports.getDistrictsByState = (req, res) => {
  const sql = `
    SELECT 
      d.id,
      d.name,
      d.state_id,
      d.status,
      s.name AS state_name,
      c.name AS country_name
    FROM districts d
    LEFT JOIN states s ON d.state_id = s.id
    LEFT JOIN countries c ON s.country_id = c.id
    WHERE d.state_id = ?
  `;

  db.query(sql, [req.params.stateId], (err, result) => {
    if (err) return sendError(res, err);
    res.json(result);
  });
};

// 🔥 CREATE
exports.createDistrict = (req, res) => {
  const { name, state_id, status } = req.body;

  db.query(
    "INSERT INTO districts (name, state_id, status) VALUES (?, ?, ?)",
    [name, state_id, status || "Active"],
    (err, result) => {
      if (err) return sendError(res, err);
      res.json({ message: "District added", id: result.insertId });
    }
  );
};

// 🔥 UPDATE
exports.updateDistrict = (req, res) => {
  const { name, state_id, status } = req.body;

  db.query(
    "UPDATE districts SET name=?, state_id=?, status=? WHERE id=?",
    [name, state_id, status || "Active", req.params.id],
    (err) => {
      if (err) return sendError(res, err);
      res.json({ message: "District updated" });
    }
  );
};

// 🔥 DELETE
exports.deleteDistrict = (req, res) => {
  db.query(
    "DELETE FROM districts WHERE id=?",
    [req.params.id],
    (err) => {
      if (err) {
        return res.status(500).json({
          error: err.message,
          message: "Cannot delete parent if children exist"
        });
      }
      res.json({ message: "District deleted" });
    }
  );
};