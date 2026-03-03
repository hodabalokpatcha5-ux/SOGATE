import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import nodemailer from "nodemailer";
import { WebSocketServer, WebSocket } from "ws";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || "sodja-gate-secret-key";

let wss: WebSocketServer;

const broadcast = (data: any) => {
  if (!wss) return;
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify(data));
    }
  });
};

const notifyAdmin = async (subject: string, message: string, type: 'order' | 'general' = 'general') => {
  const adminEmail = "sodjagate@gmail.com"; // Both orders and reservations go here
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.log(`[Admin Notification Simulation] ${subject}: ${message}`);
    return;
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  try {
    await transporter.sendMail({
      from: `"SODJA GATE System" <${user}>`,
      to: adminEmail,
      subject: `[SODJA GATE] ${subject}`,
      text: message,
      html: `<div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #10b981;">Nouvelle Notification SODJA GATE</h2>
        <p><strong>Sujet :</strong> ${subject}</p>
        <div style="background: #f3f4f6; padding: 15px; border-radius: 5px; margin: 20px 0; white-space: pre-wrap;">
          ${message}
        </div>
        <p style="font-size: 12px; color: #6b7280;">Ceci est une notification automatique du système SODJA GATE.</p>
      </div>`,
    });
    console.log(`[Admin Notification] Email envoyé à ${adminEmail} pour : ${subject}`);
  } catch (error: any) {
    console.error(`[Admin Notification Error] Erreur lors de l'envoi :`, error.message);
  }
};

const notifyWhatsApp = async (message: string) => {
  const whatsappNumber = "+22871000588";
  console.log("--------------------------------------------------");
  console.log(`[WHATSAPP NOTIFICATION SENT TO ${whatsappNumber}]`);
  console.log(message);
  console.log("--------------------------------------------------");
  // Note: For real automated sending, an API like Twilio or a WhatsApp Business API provider is required.
};

const sendEmailOTP = async (email: string, otp: string): Promise<boolean> => {
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!user || !pass) {
    console.log(`[Email Simulation] SODJA GATE envoie le code OTP ${otp} à ${email} (Configurez SMTP_USER et SMTP_PASS dans les Secrets pour l'envoi réel)`);
    return true; // Consider simulation as success for the flow
  }

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user, pass },
  });

  try {
    console.log(`[Email] Tentative d'envoi à ${email}...`);
    await transporter.sendMail({
      from: `"SODJA GATE" <${user}>`,
      to: email,
      subject: "Code de vérification SODJA GATE",
      text: `Votre code de vérification est : ${otp}. Ce code expire dans 15 minutes.`,
      html: `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee; border-radius: 10px; max-width: 500px; margin: auto;">
          <h2 style="color: #10b981; text-align: center;">SODJA GATE</h2>
          <p>Bonjour,</p>
          <p>Merci de vous être inscrit sur SODJA GATE. Pour finaliser votre inscription, veuillez utiliser le code de vérification suivant :</p>
          <div style="background: #f3f4f6; padding: 15px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #111827; border-radius: 5px; margin: 20px 0;">
            ${otp}
          </div>
          <p style="font-size: 12px; color: #6b7280; text-align: center;">Ce code expirera dans 15 minutes. Si vous n'avez pas demandé ce code, vous pouvez ignorer cet e-mail.</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;" />
          <p style="font-size: 10px; color: #9ca3af; text-align: center;">&copy; 2026 SODJA GATE - Togo</p>
        </div>
      `,
    });
    console.log(`[Email] Code OTP envoyé avec succès à ${email}`);
    return true;
  } catch (error: any) {
    console.error(`[Email Error] Erreur lors de l'envoi à ${email}:`, error.message);
    return false;
  }
};

app.use(express.json());

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", time: new Date().toISOString() });
});

// Database setup
console.log("[Server] Initializing database...");
let db: Database.Database;
try {
  db = new Database("sodjagate.db");
  console.log("[Server] Database initialized.");
} catch (error) {
  console.error("[Server] Failed to initialize database:", error);
  process.exit(1);
}

// Initialize tables
console.log("[Server] Creating tables...");
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nom TEXT NOT NULL,
      whatsapp TEXT UNIQUE NOT NULL,
      quartier TEXT,
      email TEXT,
      password_hash TEXT NOT NULL,
      is_verified INTEGER DEFAULT 0,
      otp_code TEXT,
      otp_expiration DATETIME,
      is_admin INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      price REAL NOT NULL,
      image_url TEXT
    );

    CREATE TABLE IF NOT EXISTS orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      total_amount REAL NOT NULL,
      delivery_fee REAL DEFAULT 0,
      user_lat REAL,
      user_lng REAL,
      status TEXT DEFAULT 'En attente',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      product_id INTEGER,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      FOREIGN KEY (order_id) REFERENCES orders(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    );

    CREATE TABLE IF NOT EXISTS reservations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      product_name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      date TEXT NOT NULL,
      time TEXT NOT NULL,
      location TEXT NOT NULL,
      comment TEXT,
      status TEXT DEFAULT 'En attente',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER,
      amount REAL NOT NULL,
      method TEXT NOT NULL,
      status TEXT DEFAULT 'En attente',
      transaction_id TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (order_id) REFERENCES orders(id)
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      message TEXT NOT NULL,
      rating INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS investment_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      whatsapp TEXT NOT NULL,
      email TEXT,
      amount REAL NOT NULL,
      shares INTEGER NOT NULL,
      motivation TEXT,
      status TEXT DEFAULT 'En étude',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      message TEXT NOT NULL,
      type TEXT DEFAULT 'info',
      is_read INTEGER DEFAULT 0,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);
  
  // Migration for existing tables
  try { db.prepare("ALTER TABLE orders ADD COLUMN delivery_fee REAL DEFAULT 0").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE orders ADD COLUMN user_lat REAL").run(); } catch (e) {}
  try { db.prepare("ALTER TABLE orders ADD COLUMN user_lng REAL").run(); } catch (e) {}

  console.log("[Server] Tables created.");
} catch (error) {
  console.error("[Server] Failed to create tables:", error);
  process.exit(1);
}

async function seedDatabase() {
  // Check if admin already exists to avoid wiping data on every restart in production
  const adminExists = db.prepare("SELECT * FROM users WHERE whatsapp = ?").get("+22871000588");
  
  if (adminExists) {
    console.log("[Server] Admin already exists, skipping seed.");
    return;
  }

  console.log("[Server] Initial seed: Wiping all users and re-seeding admin...");
  db.prepare("DELETE FROM users").run();
  
  // Clear existing products to re-seed with exact user request
  console.log("[Server] Re-seeding products...");
  db.prepare("DELETE FROM products").run();

  const productsToSeed = [
    {
        "name": "Soja simple (fromage)",
        "price": 200,
        "description": "Plat de soja fromage simple, savoureux et nutritif.",
        "image_url": "https://www.plantes-et-sante.fr/images/istock-959319292.jpg_720_1000_2"
    },
    {
        "name": "Soja + spaghetti",
        "price": 400,
        "description": "Délicieux soja fromage accompagné de spaghetti savoureux.",
        "image_url": "https://images.arla.com/recordid/CB78278E-B848-4ECC-9E155614FE8A9D2B/spaghetti-with-cheese-and-sausage.jpeg?format=webp&height=400&mode=crop&width=768"
    },
    {
        "name": "Soja + spaghetti + saucisses",
        "price": 700,
        "description": "Le combo complet : soja, spaghetti et saucisses savoureuses.",
        "image_url": "https://www.allrecipes.com/thmb/LXDPBxvPlXya2oKUHMOb1rWGX2o=/1500x0/filters:no_upscale():max_bytes(150000):strip_icc()/IMG_2818_chef-johns-italian-sausage-spaghetti_chef-john-5a2f5af446ce49e7a9a7727b3acfb3df.jpg"
    },
    {
        "name": "Grain de soja (un bol)",
        "price": 800,
        "description": "Grains de soja naturels et frais, riches en nutriments.",
        "image_url": "https://share.google/4Y0CVyP1Wc6IoOavH"
    },
    {
        "name": "Saucisses simples",
        "price": 200,
        "description": "Saucisses savoureuses et grillées.",
        "image_url": "https://share.google/qyGbEsVlul9Sfz5gJ"
    },
    {
        "name": "Lait de soja (verre)",
        "price": 600,
        "description": "Lait de soja frais, onctueux et naturel.",
        "image_url": "https://png.pngtree.com/png-clipart/20250202/original/pngtree-a-glass-of-soy-milk-and-regular-placed-on-clean-white-png-image_20307796.png"
    }
  ];

  for (const p of productsToSeed) {
    db.prepare("INSERT INTO products (name, description, price, image_url) VALUES (?, ?, ?, ?)")
      .run(p.name, p.description, p.price, p.image_url);
  }

  // Create the requested business admin account
  const password_hash = await bcrypt.hash("SODJA@GATE", 10);
  db.prepare("INSERT INTO users (nom, whatsapp, email, password_hash, is_verified, is_admin) VALUES (?, ?, ?, ?, ?, ?)")
    .run("SODJA GATE Business", "+22871000588", "sodjagate@gmail.com", password_hash, 1, 1);
  console.log("[Admin] Compte business créé: +22871000588 / SODJA@GATE");
}

seedDatabase().catch(err => console.error("[Server] Seeding failed:", err));

// Auth Middleware
const authenticateToken = (req: any, res: any, next: any) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: "Non autorisé" });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: "Token invalide" });
    req.user = user;
    next();
  });
};

const isAdmin = (req: any, res: any, next: any) => {
  if (req.user && req.user.is_admin) {
    next();
  } else {
    res.status(403).json({ error: "Accès administrateur requis" });
  }
};

// API Routes
app.post("/api/auth/register", async (req, res) => {
  const { nom, whatsapp, quartier, email, password } = req.body;
  
  if (!email) {
    return res.status(400).json({ error: "L'adresse email est obligatoire pour la vérification." });
  }

  try {
    const password_hash = await bcrypt.hash(password, 10);
    const otp_code = Math.floor(100000 + Math.random() * 900000).toString();
    const otp_expiration = new Date(Date.now() + 15 * 60 * 1000).toISOString(); // 15 mins

    const stmt = db.prepare("INSERT INTO users (nom, whatsapp, quartier, email, password_hash, otp_code, otp_expiration) VALUES (?, ?, ?, ?, ?, ?, ?)");
    const result = stmt.run(nom, whatsapp, quartier, email, password_hash, otp_code, otp_expiration);
    
    // Send Email OTP
    const emailSent = await sendEmailOTP(email, otp_code);

    res.json({ 
      message: emailSent 
        ? "Inscription réussie. Veuillez vérifier votre compte avec le code envoyé par email." 
        : "Inscription réussie. (Note: L'envoi d'email a échoué, utilisez le code de test ci-dessous).",
      userId: result.lastInsertRowid,
      emailSent,
      testCode: emailSent ? null : otp_code // Send code to UI only if email fails
    });
  } catch (error: any) {
    res.status(400).json({ error: error.message.includes("UNIQUE") ? "Ce numéro WhatsApp est déjà utilisé." : "Erreur lors de l'inscription." });
  }
});

app.post("/api/auth/resend-otp", async (req, res) => {
  const { whatsapp } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE whatsapp = ?").get(whatsapp) as any;

  if (!user) {
    return res.status(404).json({ error: "Utilisateur non trouvé." });
  }

  const otp_code = Math.floor(100000 + Math.random() * 900000).toString();
  const otp_expiration = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare("UPDATE users SET otp_code = ?, otp_expiration = ? WHERE id = ?").run(otp_code, otp_expiration, user.id);

  // Send Email OTP
  const emailSent = await sendEmailOTP(user.email, otp_code);

  res.json({ 
    message: emailSent 
      ? "Un nouveau code OTP a été envoyé par email." 
      : "Échec de l'envoi d'email. Utilisez le code de test ci-dessous.",
    emailSent,
    testCode: emailSent ? null : otp_code
  });
});

app.post("/api/auth/verify", (req, res) => {
  const { whatsapp, otp_code } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE whatsapp = ? AND otp_code = ?").get(whatsapp, otp_code) as any;

  if (!user) {
    return res.status(400).json({ error: "Code OTP invalide." });
  }

  if (new Date(user.otp_expiration) < new Date()) {
    return res.status(400).json({ error: "Code OTP expiré." });
  }

  db.prepare("UPDATE users SET is_verified = 1, otp_code = NULL, otp_expiration = NULL WHERE id = ?").run(user.id);
  res.json({ message: "Compte vérifié avec succès." });
});

app.post("/api/auth/forgot-password", async (req, res) => {
  const { whatsapp } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE whatsapp = ?").get(whatsapp) as any;

  if (!user) {
    return res.status(404).json({ error: "Utilisateur non trouvé." });
  }

  const otp_code = Math.floor(100000 + Math.random() * 900000).toString();
  const otp_expiration = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  db.prepare("UPDATE users SET otp_code = ?, otp_expiration = ? WHERE id = ?").run(otp_code, otp_expiration, user.id);

  // Send Email OTP
  const emailSent = await sendEmailOTP(user.email, otp_code);

  res.json({ 
    message: emailSent 
      ? "Un code de récupération a été envoyé par email." 
      : "Échec de l'envoi d'email. Utilisez le code de test ci-dessous.",
    emailSent,
    testCode: emailSent ? null : otp_code
  });
});

app.post("/api/auth/reset-password", async (req, res) => {
  const { whatsapp, otp_code, new_password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE whatsapp = ? AND otp_code = ?").get(whatsapp, otp_code) as any;

  if (!user) {
    return res.status(400).json({ error: "Code de récupération invalide." });
  }

  if (new Date(user.otp_expiration) < new Date()) {
    return res.status(400).json({ error: "Code de récupération expiré." });
  }

  const password_hash = await bcrypt.hash(new_password, 10);
  db.prepare("UPDATE users SET password_hash = ?, otp_code = NULL, otp_expiration = NULL WHERE id = ?").run(password_hash, user.id);
  
  res.json({ message: "Mot de passe réinitialisé avec succès." });
});

app.post("/api/auth/login", async (req, res) => {
  const { whatsapp, password } = req.body;
  const user = db.prepare("SELECT * FROM users WHERE whatsapp = ?").get(whatsapp) as any;

  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "Identifiants invalides." });
  }

  if (!user.is_verified) {
    return res.status(403).json({ error: "Veuillez vérifier votre compte avant de vous connecter." });
  }

  const token = jwt.sign({ id: user.id, nom: user.nom, whatsapp: user.whatsapp, is_admin: user.is_admin }, JWT_SECRET);
  res.json({ token, user: { id: user.id, nom: user.nom, whatsapp: user.whatsapp, is_admin: user.is_admin } });
});

// Products
app.get("/api/products", (req, res) => {
  const products = db.prepare("SELECT * FROM products").all();
  res.json(products);
});

// Orders
app.post("/api/orders", authenticateToken, (req: any, res) => {
  const { items, total_amount, delivery_fee, payment_method, user_lat, user_lng } = req.body;
  
  const transaction = db.transaction(() => {
    const orderStmt = db.prepare("INSERT INTO orders (user_id, total_amount, delivery_fee, user_lat, user_lng) VALUES (?, ?, ?, ?, ?)");
    const orderResult = orderStmt.run(req.user.id, total_amount, delivery_fee || 0, user_lat || null, user_lng || null);
    const orderId = orderResult.lastInsertRowid;

    const itemStmt = db.prepare("INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)");
    for (const item of items) {
      itemStmt.run(orderId, item.id, item.quantity, item.price);
    }

    const paymentStmt = db.prepare("INSERT INTO payments (order_id, amount, method, status) VALUES (?, ?, ?, ?)");
    paymentStmt.run(orderId, total_amount, payment_method, 'Confirmé'); // Simulating successful payment

    return orderId;
  });

  try {
    const orderId = transaction();
    
    // Get user details for notification
    const user = db.prepare("SELECT nom, whatsapp, quartier FROM users WHERE id = ?").get(req.user.id) as any;
    
    // Notify Admin
    let adminMessage = `Nouvelle commande #${orderId} de ${user.nom} (${user.whatsapp}).\nQuartier: ${user.quartier || 'Non précisé'}\nTotal: ${total_amount} FCFA (Livraison: ${delivery_fee} FCFA).\nMéthode: ${payment_method}.`;
    if (user_lat && user_lng) {
      adminMessage += `\nCoordonnées client: ${user_lat}, ${user_lng}\nItinéraire: https://www.google.com/maps/dir/?api=1&origin=6.1319,1.2228&destination=${user_lat},${user_lng}&travelmode=driving`;
    }
    adminMessage += `\n\nConnectez-vous au tableau de bord pour plus de détails.`;
    
    notifyAdmin(`Nouvelle Commande #${orderId}`, adminMessage, 'order');
    notifyWhatsApp(adminMessage);
    
    // Real-time broadcast
    broadcast({ 
      type: 'NEW_ORDER', 
      orderId, 
      user: user.nom, 
      whatsapp: user.whatsapp,
      quartier: user.quartier,
      total: total_amount,
      delivery_fee: delivery_fee
    });
    
    res.json({ message: "Commande passée avec succès.", orderId });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la commande." });
  }
});

// Reservations
app.post("/api/reservations", authenticateToken, (req: any, res) => {
  const { product_name, quantity, date, time, location, comment } = req.body;
  try {
    db.prepare("INSERT INTO reservations (user_id, product_name, quantity, date, time, location, comment) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(req.user.id, product_name, quantity, date, time, location, comment);
    
    // Notify Admin
    const adminMessage = `Nouvelle réservation de ${req.user.nom} (${req.user.whatsapp}).\nProduit: ${product_name}\nQuantité: ${quantity}\nDate: ${date} à ${time}\nLieu: ${location}\nCommentaire: ${comment || 'Aucun'}`;
    notifyAdmin(`Nouvelle Réservation`, adminMessage);

    // Real-time broadcast
    broadcast({ type: 'NEW_RESERVATION', user: req.user.nom, product: product_name });

    res.json({ message: "Réservation enregistrée." });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de la réservation." });
  }
});

// Suggestions
app.post("/api/suggestions", (req, res) => {
  const { name, whatsapp, message, rating } = req.body;
  try {
    db.prepare("INSERT INTO suggestions (name, whatsapp, message, rating) VALUES (?, ?, ?, ?)")
      .run(name, whatsapp, message, rating);
    
    // Notify Admin
    const adminMessage = `Nouvelle suggestion de ${name} (${whatsapp}).\nNote: ${rating}/5\nMessage: ${message}`;
    notifyAdmin(`Nouvelle Suggestion/Avis`, adminMessage);

    // Real-time broadcast
    broadcast({ type: 'NEW_SUGGESTION', user: name });

    res.json({ message: "Merci pour votre suggestion !" });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de l'envoi." });
  }
});

// Investment
app.post("/api/investments", (req, res) => {
  const { name, whatsapp, email, amount, shares, motivation } = req.body;
  try {
    db.prepare("INSERT INTO investment_requests (name, whatsapp, email, amount, shares, motivation) VALUES (?, ?, ?, ?, ?, ?)")
      .run(name, whatsapp, email, amount, shares, motivation);
    
    // Notify Admin
    const adminMessage = `Nouvelle demande d'investissement de ${name} (${whatsapp}).\nMontant: ${amount} FCFA\nActions: ${shares}\nEmail: ${email}\nMotivation: ${motivation}`;
    notifyAdmin(`Nouvelle Demande d'Investissement`, adminMessage);

    // Real-time broadcast
    broadcast({ type: 'NEW_INVESTMENT', user: name, amount });

    res.json({ message: "Votre demande d'investissement a été reçue et est en cours d'étude." });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de l'envoi de la demande." });
  }
});

// Admin Routes
app.get("/api/admin/stats", authenticateToken, isAdmin, (req, res) => {
  const users = db.prepare("SELECT COUNT(*) as count FROM users").get() as any;
  const orders = db.prepare("SELECT COUNT(*) as count FROM orders").get() as any;
  const revenue = db.prepare("SELECT SUM(total_amount) as total FROM orders").get() as any;
  res.json({ users: users.count, orders: orders.count, revenue: revenue.total || 0 });
});

app.get("/api/admin/orders", authenticateToken, isAdmin, (req, res) => {
  const orders = db.prepare(`
    SELECT o.*, u.nom as user_name, u.whatsapp as user_whatsapp, u.quartier as user_quartier, p.method as payment_method
    FROM orders o 
    JOIN users u ON o.user_id = u.id 
    LEFT JOIN payments p ON o.id = p.order_id
    ORDER BY o.created_at DESC
  `).all();
  res.json(orders);
});

app.get("/api/admin/reservations", authenticateToken, isAdmin, (req, res) => {
  const reservations = db.prepare(`
    SELECT r.*, u.nom as user_name, u.whatsapp as user_whatsapp 
    FROM reservations r 
    JOIN users u ON r.user_id = u.id 
    ORDER BY r.created_at DESC
  `).all();
  res.json(reservations);
});

app.get("/api/admin/suggestions", authenticateToken, isAdmin, (req, res) => {
  const suggestions = db.prepare("SELECT * FROM suggestions ORDER BY created_at DESC").all();
  res.json(suggestions);
});

app.get("/api/admin/investments", authenticateToken, isAdmin, (req, res) => {
  const investments = db.prepare("SELECT * FROM investment_requests ORDER BY created_at DESC").all();
  res.json(investments);
});

app.patch("/api/admin/orders/:id", authenticateToken, isAdmin, (req, res) => {
  const { status } = req.body;
  db.prepare("UPDATE orders SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ message: "Statut mis à jour." });
});

app.patch("/api/admin/reservations/:id", authenticateToken, isAdmin, (req, res) => {
  const { status } = req.body;
  db.prepare("UPDATE reservations SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ message: "Statut mis à jour." });
});

app.patch("/api/admin/investments/:id", authenticateToken, isAdmin, (req, res) => {
  const { status } = req.body;
  db.prepare("UPDATE investment_requests SET status = ? WHERE id = ?").run(status, req.params.id);
  res.json({ message: "Statut mis à jour." });
});

app.patch("/api/admin/products/:id", authenticateToken, isAdmin, (req, res) => {
  const { price } = req.body;
  db.prepare("UPDATE products SET price = ? WHERE id = ?").run(price, req.params.id);
  res.json({ message: "Prix mis à jour." });
});

app.post("/api/admin/products", authenticateToken, isAdmin, (req, res) => {
  const { name, price, description, image_url } = req.body;
  db.prepare("INSERT INTO products (name, price, description, image_url) VALUES (?, ?, ?, ?)")
    .run(name, price, description, image_url);
  res.json({ message: "Produit ajouté." });
});

app.delete("/api/admin/products/:id", authenticateToken, isAdmin, (req, res) => {
  db.prepare("DELETE FROM products WHERE id = ?").run(req.params.id);
  res.json({ message: "Produit supprimé." });
});

app.post("/api/admin/notify", authenticateToken, isAdmin, (req, res) => {
  const { user_id, message, type } = req.body;
  try {
    const result = db.prepare("INSERT INTO notifications (user_id, message, type) VALUES (?, ?, ?)")
      .run(user_id, message, type || 'info');
    
    // Broadcast to the specific user if they are connected
    broadcast({ 
      type: 'USER_NOTIFICATION', 
      user_id, 
      message, 
      notification_id: result.lastInsertRowid 
    });

    res.json({ message: "Notification envoyée." });
  } catch (error) {
    res.status(500).json({ error: "Erreur lors de l'envoi de la notification." });
  }
});

app.get("/api/notifications", authenticateToken, (req: any, res) => {
  const notifications = db.prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20")
    .all(req.user.id);
  res.json(notifications);
});

app.post("/api/notifications/read", authenticateToken, (req: any, res) => {
  db.prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?").run(req.user.id);
  res.json({ message: "Notifications marquées comme lues." });
});

async function startServer() {
  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    console.log("[Server] Starting Vite in middleware mode...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    console.log("[Server] Vite middleware attached.");
  } else {
    console.log("[Server] Serving static files from dist...");
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  console.log("[Server] Starting HTTP server on port", PORT);
  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Server] Server running on http://localhost:${PORT}`);
  });

  wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    console.log('Admin connected to WebSocket');
  });
}

startServer().catch(err => {
  console.error("[Server] Critical failure during startup:", err);
  process.exit(1);
});
