import express from "express";
import cors from "cors";
import { env } from "./lib/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import authRoutes from "./routes/auth.routes";
import categoriesRoutes from "./routes/categories.routes";
import productsRoutes from "./routes/products.routes";
import locationsRoutes from "./routes/locations.routes";
import suppliersRoutes from "./routes/suppliers.routes";
import customersRoutes from "./routes/customers.routes";
import inventoryRoutes from "./routes/inventory.routes";
import stockMovementsRoutes from "./routes/stockMovements.routes";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin }));
  app.use(express.json());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api/auth", authRoutes);
  app.use("/api/categories", categoriesRoutes);
  app.use("/api/products", productsRoutes);
  app.use("/api/locations", locationsRoutes);
  app.use("/api/suppliers", suppliersRoutes);
  app.use("/api/customers", customersRoutes);
  app.use("/api/inventory", inventoryRoutes);
  app.use("/api/stock-movements", stockMovementsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
