const db = require("../config/db");
const sendDbError = (res, err, fallbackMessage) => {
  console.error("[stateController]", err);
  return res.status(500).json({
    message: err?.sqlMessage || err?.message || fallbackMessage,
    code: err?.code || "DB_ERROR",
  });
};

exports.getStates = (req, res) => {
  db.query("SELECT * FROM states", (err, result) => {
    if (err) return sendDbError(res, err, "Failed to fetch states");
    res.json(result);
  });
};

exports.createState = (req, res) => {
  const { name, code, country_id } = req.body;

  db.query(
    "INSERT INTO states (name, code, country_id) VALUES (?, ?, ?)",
    [name, code, country_id],
    (err, result) => {
      if (err) return sendDbError(res, err, "Failed to create state");
      res.json({ message: "State created" });
    }
  );
};

exports.getStatesByCountry = (req, res) => {
  db.query(
    "SELECT * FROM states WHERE country_id = ?",
    [req.params.countryId],
    (err, result) => {
      if (err) return sendDbError(res, err, "Failed to fetch states by country");
      res.json(result);
    }
  );
};

exports.updateState = (req, res) => {
  const { name, code, country_id, status } = req.body;
  db.query(
    "UPDATE states SET name=?, code=?, country_id=?, status=? WHERE id=?",
    [name, code, country_id, status || 'Active', req.params.id],
    (err) => {
      if (err) return sendDbError(res, err, "Failed to update state");
      res.json({ message: "State updated" });
    }
  );
};

exports.deleteState = (req, res) => {
  db.query("DELETE FROM states WHERE id=?", [req.params.id], (err) => {
    if (err) return res.status(500).json({ error: err.message, message: "Cannot delete parent if children exist" });
    res.json({ message: "State deleted" });
  });
};
