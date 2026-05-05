const db = require("../config/db");

exports.getCities = (req, res) => {
  const sql = `
    SELECT 
      c.*, 
      d.name AS district_name, 
      s.name AS state_name, 
      co.name AS country_name
    FROM cities c
    LEFT JOIN districts d ON c.district_id = d.id
    LEFT JOIN states s ON c.state_id = s.id
    LEFT JOIN countries co ON s.country_id = co.id
  `;
  db.query(sql, (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
};

exports.getCitiesByDistrict = (req, res) => {
  const sql = `
    SELECT 
      c.*, 
      d.name AS district_name, 
      s.name AS state_name, 
      co.name AS country_name
    FROM cities c
    LEFT JOIN districts d ON c.district_id = d.id
    LEFT JOIN states s ON c.state_id = s.id
    LEFT JOIN countries co ON s.country_id = co.id
    WHERE c.district_id = ?
  `;
  db.query(sql, [req.params.districtId], (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
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