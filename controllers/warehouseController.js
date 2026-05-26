const db = require("../config/db");


// ================= CREATE WAREHOUSE =================
const createWarehouse = (req, res) => {

    const {
        warehouse_name,
        contact_person_name,
        address,
        country_id,
        state_id,
        district_id,
        city_id,
        pincode_id,
        phone_number,
        whatsapp_number,
        email,
        status
    } = req.body;

    const sql = `
        INSERT INTO warehouses (
            warehouse_name,
            contact_person_name,
            address,
            country_id,
            state_id,
            district_id,
            city_id,
            pincode_id,
            phone_number,
            whatsapp_number,
            email,
            status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const values = [
        warehouse_name,
        contact_person_name,
        address,
        country_id,
        state_id,
        district_id,
        city_id,
        pincode_id,
        phone_number,
        whatsapp_number,
        email,
        status || "Active"
    ];

    db.query(sql, values, (error, result) => {

        if (error) {
            console.error("Warehouse Insert Error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }

        res.status(201).json({
            success: true,
            message: "Warehouse created successfully",
            warehouse_id: result.insertId
        });

    });
};


// ================= GET ALL WAREHOUSES =================
const getWarehouses = (req, res) => {

    const sql = `
        SELECT
            w.warehouse_id,
            w.warehouse_name,
            w.contact_person_name,
            w.address,

            c.name AS country_name,
            s.name AS state_name,
            d.name AS district_name,
            ci.name AS city_name,

            p.pincode,
            p.location,

            w.phone_number,
            w.whatsapp_number,
            w.email,
            w.status,
            w.created_at

        FROM warehouses w

        LEFT JOIN countries c
        ON w.country_id = c.id

        LEFT JOIN states s
        ON w.state_id = s.id

        LEFT JOIN districts d
        ON w.district_id = d.id

        LEFT JOIN cities ci
        ON w.city_id = ci.id

        LEFT JOIN pincodes p
        ON w.pincode_id = p.id

        ORDER BY w.warehouse_id DESC
    `;

    db.query(sql, (error, rows) => {

        if (error) {
            console.error("Get Warehouse Error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            data: rows
        });

    });
};



// ================= GET SINGLE WAREHOUSE =================
const getWarehouseById = (req, res) => {

    const { id } = req.params;

    const sql = `
        SELECT * FROM warehouses
        WHERE warehouse_id = ?
    `;

    db.query(sql, [id], (error, rows) => {

        if (error) {
            console.error("Get Single Warehouse Error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }

        if (rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Warehouse not found"
            });
        }

        res.status(200).json({
            success: true,
            data: rows[0]
        });

    });
};



// ================= UPDATE WAREHOUSE =================
const updateWarehouse = (req, res) => {

    const { id } = req.params;

    const {
        warehouse_name,
        contact_person_name,
        address,
        country_id,
        state_id,
        district_id,
        city_id,
        pincode_id,
        phone_number,
        whatsapp_number,
        email,
        status
    } = req.body;

    const sql = `
        UPDATE warehouses
        SET
            warehouse_name = ?,
            contact_person_name = ?,
            address = ?,
            country_id = ?,
            state_id = ?,
            district_id = ?,
            city_id = ?,
            pincode_id = ?,
            phone_number = ?,
            whatsapp_number = ?,
            email = ?,
            status = ?
        WHERE warehouse_id = ?
    `;

    const values = [
        warehouse_name,
        contact_person_name,
        address,
        country_id,
        state_id,
        district_id,
        city_id,
        pincode_id,
        phone_number,
        whatsapp_number,
        email,
        status,
        id
    ];

    db.query(sql, values, (error, result) => {

        if (error) {
            console.error("Update Warehouse Error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            message: "Warehouse updated successfully"
        });

    });
};



// ================= DELETE WAREHOUSE =================
const deleteWarehouse = (req, res) => {

    const { id } = req.params;

    const sql = `
        DELETE FROM warehouses
        WHERE warehouse_id = ?
    `;

    db.query(sql, [id], (error, result) => {

        if (error) {
            console.error("Delete Warehouse Error:", error);

            return res.status(500).json({
                success: false,
                message: "Server Error",
                error: error.message
            });
        }

        res.status(200).json({
            success: true,
            message: "Warehouse deleted successfully"
        });

    });
};

module.exports = {
    createWarehouse,
    getWarehouses,
    getWarehouseById,
    updateWarehouse,
    deleteWarehouse
};