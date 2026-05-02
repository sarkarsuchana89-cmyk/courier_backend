const express = require("express");
const router = express.Router();
const {
  getStates,
  createState,
  getStatesByCountry,
  updateState,
  deleteState
} = require("../controllers/stateController");

router.get("/", getStates);
router.post("/", createState);
router.get("/country/:countryId", getStatesByCountry);
router.put("/:id", updateState);
router.delete("/:id", deleteState);

module.exports = router;