const express = require("express");
const router = express.Router();
const {
  createPincode,
  getPincodes,
  updatePincode,
  deletePincode,
  getByPincode // 🔥 NEW
} = require("../controllers/pincodeController");

router.post("/", createPincode);
router.get("/", getPincodes);

// 🔥 NEW → autofill API
router.get("/:pincode", getByPincode);

router.put("/:id", updatePincode);
router.delete("/:id", deletePincode);

module.exports = router;