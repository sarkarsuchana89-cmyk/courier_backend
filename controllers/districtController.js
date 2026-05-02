const db = require("../config/db");

exports.getDistricts = (req, res) => {
  db.query("SELECT * FROM districts", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
};

exports.getDistrictsByState = (req, res) => {
  db.query(
    "SELECT * FROM districts WHERE state_id = ?",
    [req.params.stateId],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    }
  );
};

exports.createDistrict = (req, res) => {
  const { name, state_id, status } = req.body;
  db.query(
    "INSERT INTO districts (name, state_id, status) VALUES (?, ?, ?)",
    [name, state_id, status || 'Active'],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "District added", id: result.insertId });
    }
  );
};

exports.updateDistrict = (req, res) => {
  const { name, state_id, status } = req.body;
  db.query(
    "UPDATE districts SET name=?, state_id=?, status=? WHERE id=?",
    [name, state_id, status, req.params.id],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "District updated" });
    }
  );
};

exports.deleteDistrict = (req, res) => {
  db.query("DELETE FROM districts WHERE id=?", [req.params.id], (err, result) => {
    if (err) return res.status(500).json({ error: err.message, message: "Cannot delete parent if children exist" });
    res.json({ message: "District deleted" });
  });
};