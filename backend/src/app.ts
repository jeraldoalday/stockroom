import express from "express";
import cors from "cors";
import { env } from "./lib/env";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler";
import { requestId } from "./middleware/requestId";
import { requestLogger } from "./middleware/requestLogger";
import authRoutes from "./routes/auth.routes";
import categoriesRoutes from "./routes/categories.routes";
import productsRoutes from "./routes/products.routes";
import locationsRoutes from "./routes/locations.routes";
import suppliersRoutes from "./routes/suppliers.routes";
import customersRoutes from "./routes/customers.routes";
import inventoryRoutes from "./routes/inventory.routes";
import stockMovementsRoutes from "./routes/stockMovements.routes";
import purchaseOrdersRoutes from "./routes/purchaseOrders.routes";
import salesOrdersRoutes from "./routes/salesOrders.routes";
import dashboardRoutes from "./routes/dashboard.routes";
import reportsRoutes from "./routes/reports.routes";
import usersRoutes from "./routes/users.routes";

export function createApp() {
  const app = express();

  // First, so every later middleware, route handler and log line can carry
  // req.id — including a request that CORS or JSON parsing itself rejects.
  app.use(requestId);
  app.use(requestLogger);

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
  app.use("/api/purchase-orders", purchaseOrdersRoutes);
  app.use("/api/sales-orders", salesOrdersRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/users", usersRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
