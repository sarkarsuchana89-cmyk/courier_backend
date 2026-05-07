const express = require("express");
const router = express.Router();
const shipmentController = require("../controllers/shipmentController");

// create shipment
router.post("/", shipmentController.createShipment);

// get all shipments
router.get("/", shipmentController.getAllShipments);

// update shipment
router.put("/:id", shipmentController.updateShipment);

// get by AWB
router.get("/:awb", shipmentController.getShipmentByAwb);

module.exports = router;
