const express = require("express");
const router = express.Router();
const shipmentController = require("../controllers/shipmentController");

// create shipment
router.post("/", shipmentController.createShipment);

// get all shipments
router.get("/", shipmentController.getAllShipments);

// update shipment
router.put("/:id", shipmentController.updateShipment);
router.delete("/:id", shipmentController.deleteShipment);

// shipment events (timeline)
router.get("/:id/events", shipmentController.getShipmentEvents);
router.post("/:id/events", shipmentController.createShipmentEvent);
router.put("/:id/events/:eventId", shipmentController.updateShipmentEvent);
router.delete("/:id/events/:eventId", shipmentController.deleteShipmentEvent);
router.post(
  "/:id/reschedule",
  shipmentController.createRescheduleRequest
);
// get by AWB
router.get("/:awb", shipmentController.getShipmentByAwb);

module.exports = router;
