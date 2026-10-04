import express from "express";
import { getNearbyCustomers, searchNameCustomer, createCustomer, deleteCustomerByID, getCustomers, getCustomersByID, updateCustomerByID } from "../controllers/customerController";

export const router = express.Router();


router.get("/", getCustomers);
router.get("/nearby", getNearbyCustomers);
router.get("/:id", getCustomersByID);
router.post("/", createCustomer);
router.delete("/:id", deleteCustomerByID);
router.put("/:id", updateCustomerByID);
router.get("/search/fields", searchNameCustomer);
