const express = require("express");
const router = express.Router();
const {
  createPincode,
  getPincodes,
  updatePincode,
  deletePincode
} = require("../controllers/pincodeController");

router.post("/", createPincode);
router.get("/", getPincodes);
router.put("/:id", updatePincode);
router.delete("/:id", deletePincode);

module.exports = router;