const express = require("express");
const router = express.Router();
const { getDistricts, getDistrictsByState, createDistrict, updateDistrict, deleteDistrict } = require("../controllers/districtController");

router.get("/", getDistricts);
router.post("/", createDistrict);
router.get("/state/:stateId", getDistrictsByState);
router.put("/:id", updateDistrict);
router.delete("/:id", deleteDistrict);

module.exports = router;