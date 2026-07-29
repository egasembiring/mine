import crypto from "crypto";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import { v4 as uuid } from "uuid";
import { getDb, updateDb } from "./storage";
import { Merchant, Product, Session, Transaction, User } from "./types";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

interface AuthenticatedRequest extends Request {
  user?: User;
  merchant?: Merchant;
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function createQrisPayload(merchantName: string, amount: number, transactionId: string): string {
  return `QRIS|MID:${merchantName.toUpperCase().slice(0, 20)}|TXN:${transactionId}|AMOUNT:${amount.toFixed(2)}`;
}

function sanitizeText(value: unknown, maxLength = 100): string {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, maxLength);
}

function parsePositiveNumber(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : NaN;
}

function createSession(userId: string): Session {
  return {
    token: uuid(),
    userId,
    createdAt: new Date().toISOString()
  };
}

function auth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing bearer token" });
    return;
  }

  const token = header.slice(7);
  const db = getDb();
  const session = db.sessions.find((item) => item.token === token);
  if (!session) {
    res.status(401).json({ message: "Invalid session" });
    return;
  }

  const user = db.users.find((item) => item.id === session.userId);
  if (!user) {
    res.status(401).json({ message: "Session user not found" });
    return;
  }

  const merchant = db.merchants.find((item) => item.userId === user.id);
  if (!merchant) {
    res.status(404).json({ message: "Merchant not found" });
    return;
  }

  req.user = user;
  req.merchant = merchant;
  next();
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

app.post("/api/auth/register", (req, res) => {
  const name = sanitizeText(req.body?.name, 60);
  const email = sanitizeText(req.body?.email, 120).toLowerCase();
  const password = sanitizeText(req.body?.password, 120);
  const businessName = sanitizeText(req.body?.businessName, 80);
  const city = sanitizeText(req.body?.city, 60) || "Jakarta";
  const category = sanitizeText(req.body?.category, 40) || "Retail";

  if (!name || !email || !password || !businessName) {
    res.status(400).json({ message: "name, email, password, businessName wajib diisi" });
    return;
  }

  const db = getDb();
  if (db.users.some((user) => user.email === email)) {
    res.status(409).json({ message: "Email sudah terdaftar" });
    return;
  }

  const user: User = {
    id: uuid(),
    name,
    email,
    passwordHash: sha256(password),
    createdAt: new Date().toISOString()
  };

  const merchant: Merchant = {
    id: uuid(),
    userId: user.id,
    businessName,
    city,
    category,
    createdAt: new Date().toISOString()
  };

  const session = createSession(user.id);

  updateDb((state) => {
    state.users.push(user);
    state.merchants.push(merchant);
    state.sessions.push(session);
  });

  res.status(201).json({
    token: session.token,
    user: { id: user.id, name: user.name, email: user.email },
    merchant
  });
});

app.post("/api/auth/login", (req, res) => {
  const email = sanitizeText(req.body?.email, 120).toLowerCase();
  const password = sanitizeText(req.body?.password, 120);

  if (!email || !password) {
    res.status(400).json({ message: "email dan password wajib diisi" });
    return;
  }

  const db = getDb();
  const user = db.users.find((item) => item.email === email);
  if (!user || user.passwordHash !== sha256(password)) {
    res.status(401).json({ message: "Email atau password salah" });
    return;
  }

  const merchant = db.merchants.find((item) => item.userId === user.id);
  if (!merchant) {
    res.status(404).json({ message: "Merchant tidak ditemukan" });
    return;
  }

  const session = createSession(user.id);
  updateDb((state) => {
    state.sessions = state.sessions.filter((item) => item.userId !== user.id);
    state.sessions.push(session);
  });

  res.json({ token: session.token, user: { id: user.id, name: user.name, email: user.email }, merchant });
});

app.get("/api/me", auth, (req: AuthenticatedRequest, res) => {
  res.json({
    user: req.user && { id: req.user.id, name: req.user.name, email: req.user.email },
    merchant: req.merchant
  });
});

app.get("/api/dashboard", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const db = getDb();
  const products = db.products.filter((item) => item.merchantId === merchantId);
  const transactions = db.transactions.filter((item) => item.merchantId === merchantId);
  const revenue = transactions.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);

  res.json({
    merchant: req.merchant,
    summary: {
      totalProducts: products.length,
      totalTransactions: transactions.length,
      pendingTransactions: transactions.filter((item) => item.status === "pending").length,
      revenue
    },
    recentTransactions: transactions.slice(-10).reverse()
  });
});

app.get("/api/products", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const products = getDb().products.filter((item) => item.merchantId === merchantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(products);
});

app.post("/api/products", auth, (req: AuthenticatedRequest, res) => {
  const name = sanitizeText(req.body?.name, 80);
  const sku = sanitizeText(req.body?.sku, 40);
  const price = parsePositiveNumber(req.body?.price);

  if (!name || !sku || Number.isNaN(price)) {
    res.status(400).json({ message: "name, sku, price wajib valid" });
    return;
  }

  const merchantId = req.merchant!.id;
  const db = getDb();
  if (db.products.some((item) => item.merchantId === merchantId && item.sku === sku)) {
    res.status(409).json({ message: "SKU sudah digunakan" });
    return;
  }

  const product: Product = {
    id: uuid(),
    merchantId,
    name,
    sku,
    price,
    active: true,
    createdAt: new Date().toISOString()
  };

  updateDb((state) => {
    state.products.push(product);
  });

  res.status(201).json(product);
});

app.put("/api/products/:id", auth, (req: AuthenticatedRequest, res) => {
  const productId = req.params.id;
  const name = sanitizeText(req.body?.name, 80);
  const sku = sanitizeText(req.body?.sku, 40);
  const price = parsePositiveNumber(req.body?.price);
  const active = Boolean(req.body?.active);

  const merchantId = req.merchant!.id;
  const db = getDb();
  const existing = db.products.find((item) => item.id === productId && item.merchantId === merchantId);

  if (!existing) {
    res.status(404).json({ message: "Produk tidak ditemukan" });
    return;
  }

  if (!name || !sku || Number.isNaN(price)) {
    res.status(400).json({ message: "name, sku, price wajib valid" });
    return;
  }

  if (db.products.some((item) => item.id !== productId && item.merchantId === merchantId && item.sku === sku)) {
    res.status(409).json({ message: "SKU sudah digunakan" });
    return;
  }

  let updated: Product = existing;

  updateDb((state) => {
    const index = state.products.findIndex((item) => item.id === productId && item.merchantId === merchantId);
    updated = {
      ...state.products[index],
      name,
      sku,
      price,
      active
    };
    state.products[index] = updated;
  });

  res.json(updated);
});

app.delete("/api/products/:id", auth, (req: AuthenticatedRequest, res) => {
  const productId = req.params.id;
  const merchantId = req.merchant!.id;

  let removed = false;

  updateDb((state) => {
    const before = state.products.length;
    state.products = state.products.filter((item) => !(item.id === productId && item.merchantId === merchantId));
    removed = before !== state.products.length;
  });

  if (!removed) {
    res.status(404).json({ message: "Produk tidak ditemukan" });
    return;
  }

  res.status(204).send();
});

app.get("/api/transactions", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const transactions = getDb().transactions
    .filter((item) => item.merchantId === merchantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(transactions);
});

app.post("/api/transactions", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const amountInput = req.body?.amount;
  const productId = sanitizeText(req.body?.productId, 100);
  const customerName = sanitizeText(req.body?.customerName, 80) || "Pelanggan";
  const notes = sanitizeText(req.body?.notes, 150);
  const db = getDb();

  let amount = parsePositiveNumber(amountInput);

  const product = productId ? db.products.find((item) => item.id === productId && item.merchantId === merchantId && item.active) : undefined;
  if (product) {
    amount = product.price;
  }

  if (Number.isNaN(amount)) {
    res.status(400).json({ message: "Nominal transaksi tidak valid" });
    return;
  }

  const merchantName = req.merchant!.businessName;
  const transactionId = uuid();
  const payload = createQrisPayload(merchantName, amount, transactionId);

  const transaction: Transaction = {
    id: transactionId,
    merchantId,
    productId: product?.id ?? null,
    amount,
    customerName,
    notes,
    status: "pending",
    qrisPayload: payload,
    createdAt: new Date().toISOString(),
    paidAt: null
  };

  updateDb((state) => {
    state.transactions.push(transaction);
  });

  res.status(201).json(transaction);
});

app.post("/api/transactions/:id/pay", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const transactionId = req.params.id;

  const db = getDb();
  const existing = db.transactions.find((item) => item.id === transactionId && item.merchantId === merchantId);

  if (!existing) {
    res.status(404).json({ message: "Transaksi tidak ditemukan" });
    return;
  }

  if (existing.status === "paid") {
    res.status(200).json(existing);
    return;
  }

  let updated: Transaction = existing;

  updateDb((state) => {
    const index = state.transactions.findIndex((item) => item.id === transactionId && item.merchantId === merchantId);
    updated = {
      ...state.transactions[index],
      status: "paid",
      paidAt: new Date().toISOString()
    };
    state.transactions[index] = updated;
  });

  res.json(updated);
});

app.get("/api/transactions/:id/qris", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const transaction = getDb().transactions.find((item) => item.id === req.params.id && item.merchantId === merchantId);

  if (!transaction) {
    res.status(404).json({ message: "Transaksi tidak ditemukan" });
    return;
  }

  const imageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(transaction.qrisPayload)}`;
  res.json({ payload: transaction.qrisPayload, imageUrl });
});

app.use("/api", (_req, res) => {
  res.status(404).json({ message: "Endpoint tidak ditemukan" });
});

app.get(/.*/, (_req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Server berjalan di http://localhost:${port}`);
});
