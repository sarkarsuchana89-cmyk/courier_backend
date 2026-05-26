const express = require("express");

const router = express.Router();

const {
    createWarehouse,
    getWarehouses,
    getWarehouseById,
    updateWarehouse,
    deleteWarehouse
} = require("../controllers/warehouseController");



// CREATE
router.post("/create", createWarehouse);


// GET ALL
router.get("/all", getWarehouses);


// GET SINGLE
router.get("/:id", getWarehouseById);


// UPDATE
router.put("/update/:id", updateWarehouse);


// DELETE
router.delete("/delete/:id", deleteWarehouse);


module.exports = router;