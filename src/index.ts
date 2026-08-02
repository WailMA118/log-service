import express from "express";
import { config } from "./config.js";

const app = express();

app.use(express.static("./src/app"));

app.listen(config.api.port, () => {
  console.log(`Server is running at http://localhost:${config.api.port}`);
});