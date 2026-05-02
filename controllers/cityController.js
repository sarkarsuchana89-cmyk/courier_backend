const db = require("../config/db");

exports.getCities = (req, res) => {
  db.query("SELECT * FROM cities", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
};

exports.getCitiesByDistrict = (req, res) => {
  db.query(
    "SELECT * FROM cities WHERE district_id = ?",
    [req.params.districtId],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json(result);
    }
  );
};

exports.createCity = (req, res) => {
  const { name, type, district_id, state_id, status } = req.body;
  db.query(
    "INSERT INTO cities (name, type, district_id, state_id, status) VALUES (?, ?, ?, ?, ?)",
    [name, type || null, district_id, state_id, status || 'Active'],
    (err, result) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "City added", id: result.insertId });
    }
  );
};

exports.updateCity = (req, res) => {
  const { name, type, district_id, state_id, status } = req.body;
  db.query(
    "UPDATE cities SET name=?, type=?, district_id=?, state_id=?, status=? WHERE id=?",
    [name, type, district_id, state_id, status, req.params.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "City updated" });
    }
  );
};

exports.deleteCity = (req, res) => {
  db.query("DELETE FROM cities WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message, message: "Cannot delete parent if children exist" });
    res.json({ message: "City deleted" });
  });
};