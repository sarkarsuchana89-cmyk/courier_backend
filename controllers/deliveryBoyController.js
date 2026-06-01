const path = require("path");
const db = require("../config/db");

const sendDbError = (res, err, fallbackMessage) => {
  console.error("[deliveryBoyController]", err);
  return res.status(500).json({
    message: err?.sqlMessage || err?.message || fallbackMessage,
    code: err?.code || "DB_ERROR",
  });
};

const toDate = (value) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
};

const pick = (...values) => {
  for (const v of values) {
    if (v === null || v === undefined) continue;
    if (typeof v === "string" && !v.trim()) continue;
    return v;
  }
  return null;
};

const parseObject = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (e) {
    return {};
  }
};

const firstWarehouseId = (raw) => {
  if (Array.isArray(raw)) return Number(raw[0]) || null;
  if (typeof raw === "string") {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) return Number(arr[0]) || null;
    } catch (e) {
      return Number(raw) || null;
    }
  }
  return Number(raw) || null;
};

const normalizeStatus = (status) => (String(status || "").trim() === "Inactive" ? "Inactive" : "Active");
const normalizeSex = (sex) => {
  const val = String(sex || "").trim();
  return ["Male", "Female", "Other"].includes(val) ? val : "Male";
};

const normalizeVehicleSpec = (value) => {
  const val = String(value || "").trim();
  const allowed = ["Personal", "Commercial", "Electric", "Self Driven", "Normal Car"];
  return allowed.includes(val) ? val : "Personal";
};

const normalizeLicenseType = (value) => {
  const val = String(value || "").trim();
  const allowed = [
    "Permanent Driving License",
    "Commercial Driving License",
    "International Driving License",
    "Learners License",
  ];
  return allowed.includes(val) ? val : null;
};

const fileUrl = (req, file) => {
  if (!file) return null;
  const base = `${req.protocol}://${req.get("host")}`;
  return `${base}/uploads/${file.filename}`;
};

const fileNameOnly = (value) => {
  if (!value) return null;
  const str = String(value).trim();
  if (!str) return null;
  return path.basename(str.replace(/\\/g, "/"));
};

const readPayload = (req) => {
  const body = req.body || {};
  const files = req.files || {};
  const presentAddressObj = parseObject(body.presentAddress);
  const currentAddressObj = parseObject(body.currentAddress);

  const adharFront = pick(
    fileNameOnly(files.adharcard_front?.[0]?.filename),
    fileNameOnly(files.adhar_front?.[0]?.filename),
    fileNameOnly(body.adharcard_front),
    fileNameOnly(body.adhar_front),
    fileNameOnly(body.aadhaar_front),
    fileNameOnly(body.adharcard_front_url),
    fileNameOnly(body.adhar_front_url),
    fileNameOnly(body.aadharFront?.name),
    fileNameOnly(body.aadharFront?.url)
  );
  const adharBack = pick(
    fileNameOnly(files.adharcard_back?.[0]?.filename),
    fileNameOnly(files.adhar_back?.[0]?.filename),
    fileNameOnly(body.adharcard_back),
    fileNameOnly(body.adhar_back),
    fileNameOnly(body.aadhaar_back),
    fileNameOnly(body.adharcard_back_url),
    fileNameOnly(body.adhar_back_url),
    fileNameOnly(body.aadharBack?.name),
    fileNameOnly(body.aadharBack?.url)
  );
  const pancard = pick(
    fileNameOnly(files.pancard?.[0]?.filename),
    fileNameOnly(files.pan_front?.[0]?.filename),
    fileNameOnly(body.pancard),
    fileNameOnly(body.pan_front),
    fileNameOnly(body.pancard_url),
    fileNameOnly(body.pan_front_url),
    fileNameOnly(body.panFront?.name),
    fileNameOnly(body.panFront?.url),
    fileNameOnly(body.panBack?.name),
    fileNameOnly(body.panBack?.url)
  );
  const photo = pick(
    fileNameOnly(files.photo?.[0]?.filename),
    fileNameOnly(files.passport_photo?.[0]?.filename),
    fileNameOnly(body.photo),
    fileNameOnly(body.passport_photo),
    fileNameOnly(body.photo_url),
    fileNameOnly(body.passport_photo_url),
    fileNameOnly(body.passportPhoto?.name),
    fileNameOnly(body.passportPhoto?.url)
  );

  return {
    name: String(pick(body.name, body.delivery_boy_name) || "").trim(),
    code: pick(body.code),
    phone_number: String(pick(body.phone_number, body.phoneNumber) || "").trim(),
    whatsapp_number: String(pick(body.whatsapp_number, body.whatsapp, body.whatsappNumber) || "").trim() || null,
    email: String(pick(body.email) || "").trim() || null,
    sex: normalizeSex(pick(body.sex, body.gender)),
    present_address: String(pick(body.present_address, presentAddressObj.address, body.fullAddress) || "").trim(),
    permanent_address: String(pick(body.permanent_address, currentAddressObj.address, body.current_address) || "").trim() || null,
    warehouse_id: Number(pick(body.warehouse_id, body.warehouseId, firstWarehouseId(body.warehouseIds))) || null,
    country_id: Number(pick(body.country_id, body.countryId)) || null,
    state_id: Number(pick(body.state_id, body.stateId)) || null,
    district_id: Number(pick(body.district_id, body.districtId)) || null,
    city_id: Number(pick(body.city_id, body.cityId)) || null,
    pincode_id: Number(pick(body.pincode_id, body.pincodeId)) || null,
    adharcard_number: String(pick(body.adharcard_number, body.adhar_number, body.aadhaar_number, body.aadharNumber) || "").trim() || null,
    adharcard_front: adharFront,
    adharcard_back: adharBack,
    pancard_number: String(pick(body.pancard_number, body.pan_number, body.panNumber) || "").trim() || null,
    pancard,
    photo,
    bank_name: String(pick(body.bank_name, body.bankName) || "").trim() || null,
    ifsc_code: String(pick(body.ifsc_code, body.ifscCode) || "").trim() || null,
    account_number: String(pick(body.account_number, body.ac_number, body.accountNumber) || "").trim() || null,
    vehicle_specification: normalizeVehicleSpec(
      pick(body.vehicle_specification, body.vehicle_classification, body.vehicle_drive_type)
    ),
    vehicle_reg_plate_number: String(
      pick(body.vehicle_reg_plate_number, body.vehicle_registration_number, body.vehicleNumber, body.vehicleRegistrationNumber)
      || "").trim() || null,
    vehicle_type: normalizeVehicleSpec(
      pick(body.vehicle_type, body.vehicleType, body.vehicleSpecificationClassification, body.vehicle_classification)
    ),
    license_type: normalizeLicenseType(pick(body.license_type, body.licenseType, body.license_type_name)),
    license_number: String(pick(body.license_number, body.licenseNumber) || "").trim() || null,
    date_of_issue: toDate(pick(body.date_of_issue, body.dateOfIssue, body.licenseIssueDate)),
    valid_till: toDate(pick(body.valid_till, body.validTill, body.licenseValidTill)),
    status: normalizeStatus(pick(body.status)),
    created_at: new Date(),
    updated_at: new Date(),
    present_state_name: String(pick(body.present_state, presentAddressObj.state) || "").trim() || null,
    present_district_name: String(pick(body.present_district, presentAddressObj.district) || "").trim() || null,
    present_city_name: String(pick(body.present_city, presentAddressObj.city) || "").trim() || null,
    present_country_name: String(pick(body.present_country, presentAddressObj.country) || "").trim() || null,
  };
};

const runQuery = (sql, values = []) =>
  new Promise((resolve, reject) => {
    db.query(sql, values, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
const parseWarehouseIds = (raw) => {
  if (!raw) return [];

  if (Array.isArray(raw)) {
    return raw.map(Number).filter(Boolean);
  }

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map(Number).filter(Boolean);
    }
  } catch (e) { }

  return [Number(raw)].filter(Boolean);
};

const saveWarehouseMappings = async (
  deliveryBoyId,
  warehouseIds = []
) => {

  await runQuery(
    `
      DELETE FROM delivery_boy_warehouses
      WHERE delivery_boy_id = ?
    `,
    [deliveryBoyId]
  );

  if (!warehouseIds.length) return;

  const values = warehouseIds.map((warehouseId) => [
    deliveryBoyId,
    warehouseId
  ]);

  await runQuery(
    `
      INSERT INTO delivery_boy_warehouses
      (
        delivery_boy_id,
        warehouse_id
      )
      VALUES ?
    `,
    [values]
  );
};
const resolveIdsFromWarehouse = async (payload) => {
  if (!payload.warehouse_id) return;
  const rows = await runQuery(
    "SELECT country_id, state_id, district_id, city_id, pincode_id FROM warehouses WHERE warehouse_id = ? LIMIT 1",
    [payload.warehouse_id]
  );
  const wh = rows?.[0] || {};
  payload.country_id = payload.country_id || wh.country_id || null;
  payload.state_id = payload.state_id || wh.state_id || null;
  payload.district_id = payload.district_id || wh.district_id || null;
  payload.city_id = payload.city_id || wh.city_id || null;
  payload.pincode_id = payload.pincode_id || wh.pincode_id || null;
};

const validatePayload = (payload) => {
  if (!payload.name) return "Name is required.";
  if (!payload.phone_number) return "Phone number is required.";
  if (!payload.present_address) return "Present address is required.";
  if (!payload.warehouse_id) return "Warehouse is required.";
  if (!payload.country_id || !payload.state_id || !payload.district_id || !payload.city_id || !payload.pincode_id) {
    return "Country, state, district, city and pincode are required.";
  }
  return null;
};

const normalizeRow = (row, req) => {
  const base = `${req.protocol}://${req.get("host")}/uploads/`;
  const adharFrontFile = fileNameOnly(row.adharcard_front);
  const adharBackFile = fileNameOnly(row.adharcard_back);
  const pancardFile = fileNameOnly(row.pancard);
  const photoFile = fileNameOnly(row.photo);
  return {
    delivery_boy_id: row.delivery_boy_id,
    id: row.delivery_boy_id,
    name: row.name,
    code: row.code,
    warehouse_name: row.warehouse_names || "",
    warehouseIds: row.warehouse_ids
      ? row.warehouse_ids
        .split(",")
        .map(id => String(id).trim())
        .filter(Boolean)
      : [],
    warehouseNames: row.warehouse_names
      ? row.warehouse_names
        .split(",")
        .map(name => name.trim())
        .filter(Boolean)
      : [],


    phone_number: row.phone_number,
    phoneNumber: row.phone_number,
    whatsapp_number: row.whatsapp_number,
    whatsapp: row.whatsapp_number,
    email: row.email,
    sex: row.sex,
    present_address: row.present_address,
    presentAddress: row.present_address,
    permanent_address: row.permanent_address,
    permanentAddress: row.permanent_address,
    warehouse_id: row.warehouse_id,
    country_id: row.country_id,
    state_id: row.state_id,
    district_id: row.district_id,
    city_id: row.city_id,
    pincode_id: row.pincode_id,
    adharcard_number: row.adharcard_number,
    adharcard_front: adharFrontFile,
    adharcard_front_url: adharFrontFile ? `${base}${adharFrontFile}` : null,
    adharcard_back: adharBackFile,
    adharcard_back_url: adharBackFile ? `${base}${adharBackFile}` : null,
    pancard_number: row.pancard_number,
    pancard: pancardFile,
    pancard_url: pancardFile ? `${base}${pancardFile}` : null,
    photo: photoFile,
    photo_url: photoFile ? `${base}${photoFile}` : null,
    bank_name: row.bank_name,
    ifsc_code: row.ifsc_code,
    account_number: row.account_number,
    vehicle_specification: row.vehicle_specification,
    vehicle_reg_plate_number: row.vehicle_reg_plate_number,
    vehicle_type: row.vehicle_type,
    license_type: row.license_type,
    license_number: row.license_number,
    date_of_issue: row.date_of_issue,
    valid_till: row.valid_till,
    status: row.status,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
};

exports.getDeliveryBoys = (req, res) => {
  db.query("SELECT * FROM delivery_boys ORDER BY delivery_boy_id DESC", (err, rows) => {
    if (err) return sendDbError(res, err, "Failed to fetch delivery boys");
    res.json((rows || []).map((r) => normalizeRow(r, req)));
  });
};

exports.getDeliveryBoyById = (req, res) => {
  db.query("SELECT * FROM delivery_boys WHERE delivery_boy_id = ?", [req.params.id], (err, rows) => {
    if (err) return sendDbError(res, err, "Failed to fetch delivery boy");
    if (!rows || rows.length === 0) return res.status(404).json({ message: "Delivery boy not found" });
    res.json(normalizeRow(rows[0], req));
  });
};

exports.createDeliveryBoy = async (req, res) => {
  const payload = readPayload(req);
  const warehouseIds =
    parseWarehouseIds(req.body.warehouseIds);
  try {
    await resolveIdsFromWarehouse(payload);
  } catch (err) {
    return sendDbError(res, err, "Failed to resolve warehouse mapping");
  }
  const validationError = validatePayload(payload);
  if (validationError) return res.status(400).json({ message: validationError });

  const sql = `
    INSERT INTO delivery_boys (
      name, code, phone_number, whatsapp_number, email, sex,
      present_address, permanent_address, warehouse_id, country_id, state_id, district_id, city_id, pincode_id,
      adharcard_number, adharcard_front, adharcard_back, pancard_number, pancard, photo,
      bank_name, ifsc_code, account_number,
      vehicle_specification, vehicle_reg_plate_number, vehicle_type,
      license_type, license_number, date_of_issue, valid_till,
      status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  const values = [
    payload.name, payload.code, payload.phone_number, payload.whatsapp_number, payload.email, payload.sex,
    payload.present_address, payload.permanent_address, payload.warehouse_id, payload.country_id, payload.state_id, payload.district_id, payload.city_id, payload.pincode_id,
    payload.adharcard_number, payload.adharcard_front, payload.adharcard_back, payload.pancard_number, payload.pancard, payload.photo,
    payload.bank_name, payload.ifsc_code, payload.account_number,
    payload.vehicle_specification, payload.vehicle_reg_plate_number, payload.vehicle_type,
    payload.license_type, payload.license_number, payload.date_of_issue, payload.valid_till,
    payload.status, payload.created_at, payload.updated_at,
  ];

  db.query(sql, values, async (err, result) => {

    if (err) {
      return sendDbError(
        res,
        err,
        "Failed to create delivery boy"
      );
    }

    try {

      await saveWarehouseMappings(
        result.insertId,
        warehouseIds.length
          ? warehouseIds
          : [payload.warehouse_id]
      );

      return res.status(201).json({
        message: "Delivery boy created",
        delivery_boy_id: result.insertId,
        id: result.insertId,
      });

    } catch (mappingErr) {

      return sendDbError(
        res,
        mappingErr,
        "Failed to save warehouse mappings"
      );

    }

  });
};

exports.updateDeliveryBoy = async (req, res) => {
  const payload = readPayload(req);
  const warehouseIds =
    parseWarehouseIds(req.body.warehouseIds);
  try {
    await resolveIdsFromWarehouse(payload);
  } catch (err) {
    return sendDbError(res, err, "Failed to resolve warehouse mapping");
  }
  const validationError = validatePayload(payload);
  if (validationError) return res.status(400).json({ message: validationError });

  payload.created_at = undefined;
  payload.updated_at = new Date();

  const sql = `
    UPDATE delivery_boys SET
      name=?, code=?, phone_number=?, whatsapp_number=?, email=?, sex=?,
      present_address=?, permanent_address=?, warehouse_id=?, country_id=?, state_id=?, district_id=?, city_id=?, pincode_id=?,
      adharcard_number=?, adharcard_front=?, adharcard_back=?, pancard_number=?, pancard=?, photo=?,
      bank_name=?, ifsc_code=?, account_number=?,
      vehicle_specification=?, vehicle_reg_plate_number=?, vehicle_type=?,
      license_type=?, license_number=?, date_of_issue=?, valid_till=?,
      status=?, updated_at=?
    WHERE delivery_boy_id=?
  `;

  const values = [
    payload.name,
    payload.code,
    payload.phone_number,
    payload.whatsapp_number,
    payload.email,
    payload.sex,
    payload.present_address,
    payload.permanent_address,
    payload.warehouse_id,
    payload.country_id,
    payload.state_id,
    payload.district_id,
    payload.city_id,
    payload.pincode_id,
    payload.adharcard_number,
    payload.adharcard_front,
    payload.adharcard_back,
    payload.pancard_number,
    payload.pancard,
    payload.photo,
    payload.bank_name,
    payload.ifsc_code,
    payload.account_number,
    payload.vehicle_specification,
    payload.vehicle_reg_plate_number,
    payload.vehicle_type,
    payload.license_type,
    payload.license_number,
    payload.date_of_issue,
    payload.valid_till,
    payload.status,
    payload.updated_at,
    req.params.id,
  ];

  db.query(sql, values, async (err) => {

    if (err) {
      return sendDbError(
        res,
        err,
        "Failed to update delivery boy"
      );
    }

    try {

      await saveWarehouseMappings(
        req.params.id,
        warehouseIds.length
          ? warehouseIds
          : [payload.warehouse_id]
      );

      return res.json({
        message: "Delivery boy updated"
      });

    } catch (mappingErr) {

      return sendDbError(
        res,
        mappingErr,
        "Failed to save warehouse mappings"
      );

    }

  });
};

// exports.deleteDeliveryBoy = (req, res) => {
//   db.query("DELETE FROM delivery_boys WHERE delivery_boy_id=?", [req.params.id], (err) => {
//     if (err) return sendDbError(res, err, "Failed to delete delivery boy");
//     res.json({ message: "Delivery boy deleted" });
//   });
// };


exports.getDeliveryBoys = (req, res) => {

  const sql = `
    SELECT
  db.*,
  GROUP_CONCAT(
    DISTINCT dbw.warehouse_id
  ) AS warehouse_ids,

  GROUP_CONCAT(
    DISTINCT w.warehouse_name
  ) AS warehouse_names

FROM delivery_boys db

LEFT JOIN delivery_boy_warehouses dbw
  ON db.delivery_boy_id = dbw.delivery_boy_id

LEFT JOIN warehouses w
  ON dbw.warehouse_id = w.warehouse_id

GROUP BY db.delivery_boy_id

ORDER BY db.delivery_boy_id DESC
  `;

  db.query(sql, (err, rows) => {

    if (err) {
      return sendDbError(res, err, "Failed to fetch delivery boys");
    }

    res.json((rows || []).map((r) => normalizeRow(r, req)));

  });

};



exports.deleteDeliveryBoy = (req, res) => {

  const sql = "DELETE FROM delivery_boys WHERE delivery_boy_id = ?";

  db.query(sql, [req.params.id], (err, result) => {

    if (err) {
      return sendDbError(res, err, "Failed to delete delivery boy");
    }

    if (result.affectedRows === 0) {
      return res.status(404).json({
        message: "Delivery boy not found",
      });
    }

    res.json({
      success: true,
      message: "Delivery boy deleted successfully",
    });

  });

};
