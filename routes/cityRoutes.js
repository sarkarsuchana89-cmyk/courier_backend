const express = require("express");
const router = express.Router();
const { getCities, getCitiesByDistrict, createCity, updateCity, deleteCity } = require("../controllers/cityController");

router.get("/", getCities);
router.post("/", createCity);
router.get("/district/:districtId", getCitiesByDistrict);
router.put("/:id", updateCity);
router.delete("/:id", deleteCity);

module.exports = router;