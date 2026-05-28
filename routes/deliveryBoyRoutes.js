const express = require("express");
const upload = require("../middlewares/uploadDeliveryBoyDocs");

const router = express.Router();

const {
  getDeliveryBoys,
  getDeliveryBoyById,
  createDeliveryBoy,
  updateDeliveryBoy,
  deleteDeliveryBoy,
} = require("../controllers/deliveryBoyController");

const deliveryBoyDocFields = upload.fields([
  { name: "adharcard_front", maxCount: 1 },
  { name: "adharcard_back", maxCount: 1 },
  { name: "pancard", maxCount: 1 },
  { name: "photo", maxCount: 1 },
  { name: "adhar_front", maxCount: 1 },
  { name: "adhar_back", maxCount: 1 },
  { name: "pan_front", maxCount: 1 },
  { name: "passport_photo", maxCount: 1 },
]);

router.get("/", getDeliveryBoys);
router.get("/:id", getDeliveryBoyById);
router.post("/", deliveryBoyDocFields, createDeliveryBoy);
router.put("/:id", deliveryBoyDocFields, updateDeliveryBoy);
router.delete("/:id", deleteDeliveryBoy);

module.exports = router;

