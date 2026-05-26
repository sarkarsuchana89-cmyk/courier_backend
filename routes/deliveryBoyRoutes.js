const express = require("express");
const router = express.Router();
const {
  getDeliveryBoys,
  createDeliveryBoy,
  updateDeliveryBoy,
  deleteDeliveryBoy,
} = require("../controllers/deliveryBoyController");

router.get("/", getDeliveryBoys);
router.post("/", createDeliveryBoy);
router.put("/:id", updateDeliveryBoy);
router.delete("/:id", deleteDeliveryBoy);

module.exports = router;
