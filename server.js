process.env.TZ = "Asia/Kolkata";
const express = require("express");
const cors = require("cors");

const stateRoutes = require("./routes/stateRoutes");
const districtRoutes = require("./routes/districtRoutes");
const cityRoutes = require("./routes/cityRoutes");
const pincodeRoutes = require("./routes/pincodeRoutes");
const countryRoutes = require("./routes/countryRoutes");
const shipmentRoutes = require("./routes/shipmentRoutes");

const otpRoutes = require("./routes/otpRoutes");

const app = express();

app.use(cors());
app.use(express.json());
app.use("/api/shipments", shipmentRoutes);
app.use("/api/states", stateRoutes);
app.use("/api/districts", districtRoutes);
app.use("/api/cities", cityRoutes);
app.use("/api/pincodes", pincodeRoutes);
app.use("/api/countries", countryRoutes);
app.use("/api/otp", otpRoutes);
app.use("/",(req,res)=>{
    res.send("Hello World")
})
app.listen(3000, () => {
  console.log("Server running on port 3000 🚀");
});
