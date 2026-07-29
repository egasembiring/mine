import crypto from "crypto";
import express, { NextFunction, Request, Response } from "express";
import cors from "cors";
import path from "path";
import { v4 as uuid } from "uuid";
import { getDb, updateDb } from "./storage";
import { ActorRole, ActorType, AuditLog, Merchant, Product, Session, TeamMember, Transaction, User } from "./types";

const app = express();
const port = Number(process.env.PORT ?? 3000);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

interface AuthenticatedRequest extends Request {
  user?: User;
  merchant?: Merchant;
  teamMember?: TeamMember;
  actorType?: ActorType;
  actorRole?: ActorRole;
  actorName?: string;
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

function paramToString(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function createSession(params: {
  merchantId: string;
  actorType: ActorType;
  actorId: string;
  role: ActorRole;
}): Session {
  return {
    token: uuid(),
    merchantId: params.merchantId,
    actorType: params.actorType,
    actorId: params.actorId,
    role: params.role,
    createdAt: new Date().toISOString()
  };
}

function addAuditLog(state: ReturnType<typeof getDb>, payload: Omit<AuditLog, "id" | "createdAt">): void {
  state.auditLogs.push({
    id: uuid(),
    createdAt: new Date().toISOString(),
    ...payload
  });
}

function auth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    res.status(401).json({ message: "Missing bearer token" });
    return;
  }

  const token = header.slice(7);
  const db = getDb();
  const rawSession = db.sessions.find((item) => item.token === token) as any;

  if (!rawSession) {
    res.status(401).json({ message: "Invalid session" });
    return;
  }

  const merchant = db.merchants.find((item) => item.id === rawSession.merchantId) ?? db.merchants.find((item) => item.userId === rawSession.actorId || item.userId === rawSession.userId);
  if (!merchant) {
    res.status(404).json({ message: "Merchant not found" });
    return;
  }

  if (rawSession.actorType === "team_member") {
    const member = db.teamMembers.find((item) => item.id === rawSession.actorId && item.merchantId === merchant.id && item.active);
    if (!member) {
      res.status(401).json({ message: "Session team member not found" });
      return;
    }

    req.merchant = merchant;
    req.teamMember = member;
    req.actorType = "team_member";
    req.actorRole = member.role;
    req.actorName = member.name;
    next();
    return;
  }

  const user = db.users.find((item) => item.id === rawSession.actorId || item.id === rawSession.userId);
  if (!user) {
    res.status(401).json({ message: "Session owner not found" });
    return;
  }

  req.user = user;
  req.merchant = merchant;
  req.actorType = "owner";
  req.actorRole = "owner";
  req.actorName = user.name;
  next();
}

function requireRole(role: ActorRole) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (req.actorRole !== role) {
      res.status(403).json({ message: `Role ${role} diperlukan` });
      return;
    }
    next();
  };
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
  if (db.users.some((user) => user.email === email) || db.teamMembers.some((member) => member.email === email)) {
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

  const session = createSession({
    merchantId: merchant.id,
    actorType: "owner",
    actorId: user.id,
    role: "owner"
  });

  updateDb((state) => {
    state.users.push(user);
    state.merchants.push(merchant);
    state.sessions.push(session);
    addAuditLog(state, {
      merchantId: merchant.id,
      actorType: "owner",
      actorName: user.name,
      actorRole: "owner",
      action: "owner.registered",
      targetType: "merchant",
      targetId: merchant.id,
      details: `Owner ${user.email} mendaftarkan merchant`
    });
  });

  res.status(201).json({
    token: session.token,
    actor: { role: "owner", type: "owner", name: user.name, email: user.email },
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

  const owner = db.users.find((item) => item.email === email && item.passwordHash === sha256(password));
  if (owner) {
    const merchant = db.merchants.find((item) => item.userId === owner.id);
    if (!merchant) {
      res.status(404).json({ message: "Merchant tidak ditemukan" });
      return;
    }

    const session = createSession({
      merchantId: merchant.id,
      actorType: "owner",
      actorId: owner.id,
      role: "owner"
    });

    updateDb((state) => {
      state.sessions = state.sessions.filter((item) => !(item.actorType === "owner" && item.actorId === owner.id));
      state.sessions.push(session);
      addAuditLog(state, {
        merchantId: merchant.id,
        actorType: "owner",
        actorName: owner.name,
        actorRole: "owner",
        action: "auth.login",
        targetType: "session",
        targetId: session.token,
        details: "Owner login"
      });
    });

    res.json({
      token: session.token,
      actor: { role: "owner", type: "owner", name: owner.name, email: owner.email },
      merchant
    });
    return;
  }

  const member = db.teamMembers.find((item) => item.email === email && item.passwordHash === sha256(password) && item.active);
  if (!member) {
    res.status(401).json({ message: "Email atau password salah" });
    return;
  }

  const merchant = db.merchants.find((item) => item.id === member.merchantId);
  if (!merchant) {
    res.status(404).json({ message: "Merchant tidak ditemukan" });
    return;
  }

  const session = createSession({
    merchantId: merchant.id,
    actorType: "team_member",
    actorId: member.id,
    role: member.role
  });

  updateDb((state) => {
    state.sessions = state.sessions.filter((item) => !(item.actorType === "team_member" && item.actorId === member.id));
    state.sessions.push(session);
    addAuditLog(state, {
      merchantId: merchant.id,
      actorType: "team_member",
      actorName: member.name,
      actorRole: member.role,
      action: "auth.login",
      targetType: "session",
      targetId: session.token,
      details: `Team member ${member.email} login`
    });
  });

  res.json({
    token: session.token,
    actor: { role: member.role, type: "team_member", name: member.name, email: member.email },
    merchant
  });
});

app.get("/api/me", auth, (req: AuthenticatedRequest, res) => {
  res.json({
    actor: {
      type: req.actorType,
      role: req.actorRole,
      name: req.actorName,
      email: req.user?.email ?? req.teamMember?.email ?? ""
    },
    merchant: req.merchant
  });
});

app.get("/api/dashboard", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const db = getDb();
  const products = db.products.filter((item) => item.merchantId === merchantId);
  const transactions = db.transactions.filter((item) => item.merchantId === merchantId);
  const teamMembers = db.teamMembers.filter((item) => item.merchantId === merchantId && item.active);
  const revenue = transactions.filter((item) => item.status === "paid").reduce((sum, item) => sum + item.amount, 0);

  res.json({
    merchant: req.merchant,
    actor: { type: req.actorType, role: req.actorRole, name: req.actorName },
    summary: {
      totalProducts: products.length,
      totalTransactions: transactions.length,
      pendingTransactions: transactions.filter((item) => item.status === "pending").length,
      teamMembers: teamMembers.length,
      revenue
    },
    recentTransactions: transactions.slice(-10).reverse()
  });
});

app.get("/api/team-members", auth, requireRole("owner"), (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const members = getDb()
    .teamMembers.filter((item) => item.merchantId === merchantId && item.active)
    .map((item) => ({
      id: item.id,
      name: item.name,
      email: item.email,
      role: item.role,
      createdAt: item.createdAt
    }));

  res.json(members);
});

app.post("/api/team-members", auth, requireRole("owner"), (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const name = sanitizeText(req.body?.name, 60);
  const email = sanitizeText(req.body?.email, 120).toLowerCase();
  const password = sanitizeText(req.body?.password, 120);
  const roleInput = sanitizeText(req.body?.role, 20);
  const role: ActorRole = roleInput === "cashier" ? "cashier" : "cashier";

  if (!name || !email || !password) {
    res.status(400).json({ message: "name, email, password wajib diisi" });
    return;
  }

  const db = getDb();
  if (db.users.some((item) => item.email === email) || db.teamMembers.some((item) => item.email === email)) {
    res.status(409).json({ message: "Email sudah terdaftar" });
    return;
  }

  const member: TeamMember = {
    id: uuid(),
    merchantId,
    name,
    email,
    passwordHash: sha256(password),
    role,
    active: true,
    createdAt: new Date().toISOString()
  };

  updateDb((state) => {
    state.teamMembers.push(member);
    addAuditLog(state, {
      merchantId,
      actorType: req.actorType!,
      actorName: req.actorName!,
      actorRole: req.actorRole!,
      action: "team_member.created",
      targetType: "team_member",
      targetId: member.id,
      details: `Tambah member ${member.email} sebagai ${member.role}`
    });
  });

  res.status(201).json({ id: member.id, name: member.name, email: member.email, role: member.role, createdAt: member.createdAt });
});

app.post("/api/team-members/:id/deactivate", auth, requireRole("owner"), (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const memberId = paramToString(req.params.id);
  const db = getDb();
  const existing = db.teamMembers.find((item) => item.id === memberId && item.merchantId === merchantId && item.active);

  if (!existing) {
    res.status(404).json({ message: "Team member tidak ditemukan" });
    return;
  }

  updateDb((state) => {
    const index = state.teamMembers.findIndex((item) => item.id === memberId && item.merchantId === merchantId);
    state.teamMembers[index] = { ...state.teamMembers[index], active: false };
    state.sessions = state.sessions.filter((item) => !(item.actorType === "team_member" && item.actorId === memberId));
    addAuditLog(state, {
      merchantId,
      actorType: req.actorType!,
      actorName: req.actorName!,
      actorRole: req.actorRole!,
      action: "team_member.deactivated",
      targetType: "team_member",
      targetId: memberId,
      details: `Nonaktifkan member ${existing.email}`
    });
  });

  res.status(204).send();
});

app.get("/api/products", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const products = getDb().products.filter((item) => item.merchantId === merchantId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(products);
});

app.post("/api/products", auth, requireRole("owner"), (req: AuthenticatedRequest, res) => {
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
    addAuditLog(state, {
      merchantId,
      actorType: req.actorType!,
      actorName: req.actorName!,
      actorRole: req.actorRole!,
      action: "product.created",
      targetType: "product",
      targetId: product.id,
      details: `Tambah produk ${product.name}`
    });
  });

  res.status(201).json(product);
});

app.put("/api/products/:id", auth, requireRole("owner"), (req: AuthenticatedRequest, res) => {
  const productId = paramToString(req.params.id);
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
    addAuditLog(state, {
      merchantId,
      actorType: req.actorType!,
      actorName: req.actorName!,
      actorRole: req.actorRole!,
      action: "product.updated",
      targetType: "product",
      targetId: productId,
      details: `Ubah produk ${name}`
    });
  });

  res.json(updated);
});

app.delete("/api/products/:id", auth, requireRole("owner"), (req: AuthenticatedRequest, res) => {
  const productId = paramToString(req.params.id);
  const merchantId = req.merchant!.id;

  let removed = false;

  updateDb((state) => {
    const before = state.products.length;
    state.products = state.products.filter((item) => !(item.id === productId && item.merchantId === merchantId));
    removed = before !== state.products.length;
    if (removed) {
      addAuditLog(state, {
        merchantId,
        actorType: req.actorType!,
        actorName: req.actorName!,
        actorRole: req.actorRole!,
        action: "product.deleted",
        targetType: "product",
        targetId: productId,
        details: "Hapus produk"
      });
    }
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
    addAuditLog(state, {
      merchantId,
      actorType: req.actorType!,
      actorName: req.actorName!,
      actorRole: req.actorRole!,
      action: "transaction.created",
      targetType: "transaction",
      targetId: transaction.id,
      details: `Buat transaksi ${transaction.amount}`
    });
  });

  res.status(201).json(transaction);
});

app.post("/api/transactions/:id/pay", auth, requireRole("owner"), (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const transactionId = paramToString(req.params.id);

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
    addAuditLog(state, {
      merchantId,
      actorType: req.actorType!,
      actorName: req.actorName!,
      actorRole: req.actorRole!,
      action: "transaction.paid",
      targetType: "transaction",
      targetId: transactionId,
      details: "Set transaksi lunas"
    });
  });

  res.json(updated);
});

app.get("/api/transactions/:id/qris", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const transactionId = paramToString(req.params.id);
  const transaction = getDb().transactions.find((item) => item.id === transactionId && item.merchantId === merchantId);

  if (!transaction) {
    res.status(404).json({ message: "Transaksi tidak ditemukan" });
    return;
  }

  const imageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=280x280&data=${encodeURIComponent(transaction.qrisPayload)}`;
  res.json({ payload: transaction.qrisPayload, imageUrl });
});

app.get("/api/audit-logs", auth, (req: AuthenticatedRequest, res) => {
  const merchantId = req.merchant!.id;
  const limitValue = Number(req.query.limit);
  const limit = Number.isFinite(limitValue) && limitValue > 0 ? Math.min(limitValue, 200) : 100;
  const logs = getDb()
    .auditLogs.filter((item) => item.merchantId === merchantId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, limit);
  res.json(logs);
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
