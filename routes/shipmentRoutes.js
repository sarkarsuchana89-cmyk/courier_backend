const express = require("express");
const router = express.Router();
const shipmentController = require("../controllers/shipmentController");

// create shipment
router.post("/", shipmentController.createShipment);

// get all shipments
router.get("/", shipmentController.getAllShipments);

module.exports = router;