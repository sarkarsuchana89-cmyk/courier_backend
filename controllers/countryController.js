const db = require("../config/db");

const sendDbError = (res, err, fallbackMessage) => {
  console.error("[countryController]", err);
  return res.status(500).json({
    message: err?.sqlMessage || err?.message || fallbackMessage,
    code: err?.code || "DB_ERROR",
  });
};

exports.getCountries = (req, res) => {
  db.query("SELECT * FROM countries", (err, result) => {
    if (err) return sendDbError(res, err, "Failed to fetch countries");
    res.json(result);
  });
};

exports.createCountry = (req, res) => {
  const { name, code, status } = req.body;
  db.query(
    "INSERT INTO countries (name, code, status) VALUES (?, ?, ?)",
    [name, code, status || "Active"],
    (err) => {
      if (err) return sendDbError(res, err, "Failed to create country");
      res.json({ message: "Country created" });
    }
  );
};

exports.updateCountry = (req, res) => {
  const { name, code, status } = req.body;
  db.query(
    "UPDATE countries SET name=?, code=?, status=? WHERE id=?",
    [name, code, status || "Active", req.params.id],
    (err) => {
      if (err) return sendDbError(res, err, "Failed to update country");
      res.json({ message: "Country updated" });
    }
  );
};

exports.deleteCountry = (req, res) => {
  db.query("DELETE FROM countries WHERE id=?", [req.params.id], (err) => {
    if (err) return sendDbError(res, err, "Cannot delete country if children exist");
    res.json({ message: "Country deleted" });
  });
};

