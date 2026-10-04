import express from "express";
import cors from "cors";
import { router as customerRoutes } from "./src/routes/customerRoutes";
import { router as orderRoutes } from "./src/routes/orderRoutes";
import { router as planningRoutes } from "./src/routes/planningRoutes";
import { router as jobRoutes } from "./src/routes/jobRoutes";

export const app = express();

app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.text());


app.use("/api/customer", customerRoutes);
app.use("/api/order", orderRoutes);
app.use("/api/route", planningRoutes);
app.use("/api/jobs", jobRoutes);

export default app;
