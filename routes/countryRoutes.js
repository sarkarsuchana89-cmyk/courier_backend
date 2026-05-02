const express = require("express");
const router = express.Router();
const {
  getCountries,
  createCountry,
  updateCountry,
  deleteCountry,
} = require("../controllers/countryController");

router.get("/", getCountries);
router.post("/", createCountry);
router.put("/:id", updateCountry);
router.delete("/:id", deleteCountry);

module.exports = router;

