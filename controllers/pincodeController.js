const db = require("../config/db");

exports.createPincode = (req, res) => {
  const { pincode, location, city, state_id, district_id } = req.body;

  db.query(
    "INSERT INTO pincodes (pincode, location, city, state_id, district_id) VALUES (?, ?, ?, ?, ?)",
    [pincode, location, city, state_id, district_id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Pincode added" });
    }
  );
};

exports.getPincodes = (req, res) => {
  db.query("SELECT * FROM pincodes", (err, result) => {
    if (err) return res.status(500).json(err);
    res.json(result);
  });
};

exports.updatePincode = (req, res) => {
  const { pincode, location, city, state_id, district_id, status } = req.body;
  db.query(
    "UPDATE pincodes SET pincode=?, location=?, city=?, state_id=?, district_id=?, status=? WHERE id=?",
    [pincode, location, city, state_id, district_id, status || 'Active', req.params.id],
    (err) => {
      if (err) return res.status(500).json(err);
      res.json({ message: "Pincode updated" });
    }
  );
};

exports.deletePincode = (req, res) => {
  db.query("DELETE FROM pincodes WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json(err);
    res.json({ message: "Pincode deleted" });
  });
};