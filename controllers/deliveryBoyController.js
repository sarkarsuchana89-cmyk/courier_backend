const db = require("../config/db");

const maxDocumentSize = 1024 * 1024;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const createTableSql = `
  CREATE TABLE IF NOT EXISTS delivery_boys (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    full_address TEXT NOT NULL,
    phone_number VARCHAR(30) NOT NULL,
    whatsapp VARCHAR(30) NOT NULL,
    email VARCHAR(150) NOT NULL,
    adhar_name VARCHAR(255) NULL,
    adhar_size INT NULL,
    adhar_type VARCHAR(120) NULL,
    adhar_url LONGTEXT NULL,
    pan_name VARCHAR(255) NULL,
    pan_size INT NULL,
    pan_type VARCHAR(120) NULL,
    pan_url LONGTEXT NULL,
    passport_photo_name VARCHAR(255) NULL,
    passport_photo_size INT NULL,
    passport_photo_type VARCHAR(120) NULL,
    passport_photo_url LONGTEXT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
  )
`;

const sendDbError = (res, err, fallbackMessage) => {
  console.error("[deliveryBoyController]", err);
  return res.status(500).json({
    message: err?.sqlMessage || err?.message || fallbackMessage,
    code: err?.code || "DB_ERROR",
  });
};

const ensureTable = (res, callback) => {
  db.query(createTableSql, (err) => {
    if (err) return sendDbError(res, err, "Failed to prepare delivery boy table");
    callback();
  });
};

const documentFromBody = (body, key) => {
  const document = body?.[key] || {};
  return {
    name: document.name || null,
    size: document.size || null,
    type: document.type || null,
    url: document.url || null,
  };
};

const normalizeRow = (row) => ({
  id: row.id,
  name: row.name || "",
  fullAddress: row.full_address || "",
  phoneNumber: row.phone_number || "",
  whatsapp: row.whatsapp || "",
  email: row.email || "",
  status: row.status || "Active",
  adhar: row.adhar_url ? {
    name: row.adhar_name,
    size: row.adhar_size,
    type: row.adhar_type,
    url: row.adhar_url,
  } : null,
  pan: row.pan_url ? {
    name: row.pan_name,
    size: row.pan_size,
    type: row.pan_type,
    url: row.pan_url,
  } : null,
  passportPhoto: row.passport_photo_url ? {
    name: row.passport_photo_name,
    size: row.passport_photo_size,
    type: row.passport_photo_type,
    url: row.passport_photo_url,
  } : null,
  created_at: row.created_at,
  updated_at: row.updated_at,
});

const validateDeliveryBoy = (body) => {
  if (!String(body.name || "").trim()) return "Name is required.";
  if (!String(body.fullAddress || "").trim()) return "Full address is required.";
  if (!String(body.phoneNumber || "").trim()) return "Phone number is required.";
  if (!String(body.whatsapp || "").trim()) return "Whatsapp number is required.";
  if (!String(body.email || "").trim()) return "Email is required.";
  if (!emailPattern.test(String(body.email || "").trim())) return "Please enter a valid email address.";

  for (const key of ["adhar", "pan", "passportPhoto"]) {
    const size = Number(body?.[key]?.size || 0);
    if (size > maxDocumentSize) return "Document size must be 1 MB or less.";
  }

  return null;
};

const valuesFromBody = (body) => {
  const adhar = documentFromBody(body, "adhar");
  const pan = documentFromBody(body, "pan");
  const passportPhoto = documentFromBody(body, "passportPhoto");

  return [
    String(body.name || "").trim(),
    String(body.fullAddress || "").trim(),
    String(body.phoneNumber || "").trim(),
    String(body.whatsapp || "").trim(),
    String(body.email || "").trim(),
    adhar.name,
    adhar.size,
    adhar.type,
    adhar.url,
    pan.name,
    pan.size,
    pan.type,
    pan.url,
    passportPhoto.name,
    passportPhoto.size,
    passportPhoto.type,
    passportPhoto.url,
    body.status || "Active",
  ];
};

exports.getDeliveryBoys = (req, res) => {
  ensureTable(res, () => {
    db.query("SELECT * FROM delivery_boys ORDER BY id DESC", (err, result) => {
      if (err) return sendDbError(res, err, "Failed to fetch delivery boys");
      res.json((Array.isArray(result) ? result : []).map(normalizeRow));
    });
  });
};

exports.createDeliveryBoy = (req, res) => {
  const validationMessage = validateDeliveryBoy(req.body || {});
  if (validationMessage) return res.status(400).json({ message: validationMessage });

  ensureTable(res, () => {
    const sql = `
      INSERT INTO delivery_boys (
        name, full_address, phone_number, whatsapp, email,
        adhar_name, adhar_size, adhar_type, adhar_url,
        pan_name, pan_size, pan_type, pan_url,
        passport_photo_name, passport_photo_size, passport_photo_type, passport_photo_url,
        status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, valuesFromBody(req.body), (err, result) => {
      if (err) return sendDbError(res, err, "Failed to create delivery boy");
      res.json({ message: "Delivery boy created", id: result.insertId });
    });
  });
};

exports.updateDeliveryBoy = (req, res) => {
  const validationMessage = validateDeliveryBoy(req.body || {});
  if (validationMessage) return res.status(400).json({ message: validationMessage });

  ensureTable(res, () => {
    const sql = `
      UPDATE delivery_boys SET
        name=?, full_address=?, phone_number=?, whatsapp=?, email=?,
        adhar_name=?, adhar_size=?, adhar_type=?, adhar_url=?,
        pan_name=?, pan_size=?, pan_type=?, pan_url=?,
        passport_photo_name=?, passport_photo_size=?, passport_photo_type=?, passport_photo_url=?,
        status=?
      WHERE id=?
    `;

    db.query(sql, [...valuesFromBody(req.body), req.params.id], (err) => {
      if (err) return sendDbError(res, err, "Failed to update delivery boy");
      res.json({ message: "Delivery boy updated" });
    });
  });
};

exports.deleteDeliveryBoy = (req, res) => {
  ensureTable(res, () => {
    db.query("DELETE FROM delivery_boys WHERE id=?", [req.params.id], (err) => {
      if (err) return sendDbError(res, err, "Failed to delete delivery boy");
      res.json({ message: "Delivery boy deleted" });
    });
  });
};
