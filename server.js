const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PORT = process.env.PORT || 3001;

// Initialize Firebase Admin
initializeApp({
  credential: cert({
    projectId: process.env.PROJECT_ID,
    clientEmail: process.env.CLIENT_EMAIL,
    privateKey: process.env.RSA.replace(/\\n/g, '\n')
  }),
});

const db = getFirestore();

// Middleware
app.use(cors());
app.use(express.json());

// Constants
const COLLECTION = "dataCollection";
const EMAIL = process.env.EMAIL;

// Helper function to get IST timestamp
function getTimestampString() {
  const date = new Date();
  const ISTOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const offsetDate = new Date(date.getTime() + ISTOffset);

  const year = offsetDate.getUTCFullYear();
  const month = String(offsetDate.getUTCMonth() + 1).padStart(2, "0");
  const day = String(offsetDate.getUTCDate()).padStart(2, "0");
  const hours = String(offsetDate.getUTCHours()).padStart(2, "0");
  const minutes = String(offsetDate.getUTCMinutes()).padStart(2, "0");
  const seconds = String(offsetDate.getUTCSeconds()).padStart(2, "0");

  return `${year}:${month}:${day} ${hours}:${minutes}:${seconds}`;
}

// Function to save data to Firestore
const saveDataToFirestore = async (value1, value2, value3) => {
  const timestamp = getTimestampString();
  
  try {
    // Create a new document with auto-generated ID
    const docRef = await db
      .collection(COLLECTION)
      .doc(EMAIL)
      .collection("readings")
      .add({
        value1: value1,
        value2: value2,
        value3: value3,
        timestamp: timestamp,
        createdAt: new Date()
      });

    console.log("Data saved to Firestore with ID:", docRef.id);
    return { success: true, id: docRef.id };
  } catch (error) {
    console.error("Error saving to Firestore:", error);
    return { success: false, error: error.message };
  }
};

// Routes
app.get("/", (req, res) => {
  res.status(200).json({ message: "Server is running", timestamp: new Date().toISOString() });
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "healthy", message: "Server is operational" });
});

// GET all data records
app.get("/data", async (req, res) => {
  try {
    const { limit = 50, orderBy = "createdAt", order = "desc" } = req.query;
    
    let query = db
      .collection(COLLECTION)
      .doc(EMAIL)
      .collection("readings")
      .orderBy(orderBy, order)
      .limit(parseInt(limit));

    const snapshot = await query.get();
    
    if (snapshot.empty) {
      return res.status(200).json({ 
        message: "No data found", 
        data: [],
        count: 0 
      });
    }

    const data = [];
    snapshot.forEach(doc => {
      data.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({ 
      message: "Data retrieved successfully", 
      data: data,
      count: data.length 
    });

  } catch (error) {
    console.error("Error retrieving data:", error);
    res.status(500).json({ 
      error: "Failed to retrieve data", 
      message: error.message 
    });
  }
});

// GET data by ID
app.get("/data/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const doc = await db
      .collection(COLLECTION)
      .doc(EMAIL)
      .collection("readings")
      .doc(id)
      .get();

    if (!doc.exists) {
      return res.status(404).json({ 
        error: "Data not found", 
        id: id 
      });
    }

    res.status(200).json({ 
      message: "Data retrieved successfully", 
      data: {
        id: doc.id,
        ...doc.data()
      }
    });

  } catch (error) {
    console.error("Error retrieving data by ID:", error);
    res.status(500).json({ 
      error: "Failed to retrieve data", 
      message: error.message 
    });
  }
});

// GET latest data record
app.get("/data/latest", async (req, res) => {
  try {
    const snapshot = await db
      .collection(COLLECTION)
      .doc(EMAIL)
      .collection("readings")
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ 
        message: "No data found", 
        data: null 
      });
    }

    const doc = snapshot.docs[0];
    res.status(200).json({ 
      message: "Latest data retrieved successfully", 
      data: {
        id: doc.id,
        ...doc.data()
      }
    });

  } catch (error) {
    console.error("Error retrieving latest data:", error);
    res.status(500).json({ 
      error: "Failed to retrieve latest data", 
      message: error.message 
    });
  }
});

// GET data with date range filter
app.get("/data/range", async (req, res) => {
  try {
    const { startDate, endDate, limit = 100 } = req.query;
    
    if (!startDate || !endDate) {
      return res.status(400).json({ 
        error: "Missing required parameters", 
        required: ["startDate", "endDate"],
        format: "YYYY-MM-DD"
      });
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999); // Include the entire end date

    const snapshot = await db
      .collection(COLLECTION)
      .doc(EMAIL)
      .collection("readings")
      .where("createdAt", ">=", start)
      .where("createdAt", "<=", end)
      .orderBy("createdAt", "desc")
      .limit(parseInt(limit))
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ 
        message: "No data found in the specified range", 
        data: [],
        count: 0,
        range: { startDate, endDate }
      });
    }

    const data = [];
    snapshot.forEach(doc => {
      data.push({
        id: doc.id,
        ...doc.data()
      });
    });

    res.status(200).json({ 
      message: "Data retrieved successfully", 
      data: data,
      count: data.length,
      range: { startDate, endDate }
    });

  } catch (error) {
    console.error("Error retrieving data by range:", error);
    res.status(500).json({ 
      error: "Failed to retrieve data", 
      message: error.message 
    });
  }
});

// DELETE data by ID
app.delete("/data/:id", async (req, res) => {
  try {
    const { id } = req.params;
    
    const docRef = db
      .collection(COLLECTION)
      .doc(EMAIL)
      .collection("readings")
      .doc(id);

    const doc = await docRef.get();
    if (!doc.exists) {
      return res.status(404).json({ 
        error: "Data not found", 
        id: id 
      });
    }

    await docRef.delete();

    res.status(200).json({ 
      message: "Data deleted successfully", 
      id: id 
    });

  } catch (error) {
    console.error("Error deleting data:", error);
    res.status(500).json({ 
      error: "Failed to delete data", 
      message: error.message 
    });
  }
});

app.post("/data", async (req, res) => {
  try {
    const { value1, value2, value3 } = req.body;

    // Validate required fields
    if (value1 === undefined || value2 === undefined || value3 === undefined) {
      return res.status(400).json({ 
        error: "Missing required fields", 
        required: ["value1", "value2", "value3"] 
      });
    }

    console.log("Received data:", { value1, value2, value3 });

    // Save to Firestore
    const result = await saveDataToFirestore(value1, value2, value3);

    if (result.success) {
      res.status(200).json({ 
        message: "Data saved successfully", 
        id: result.id,
        timestamp: getTimestampString()
      });
    } else {
      res.status(500).json({ 
        error: "Failed to save data", 
        details: result.error 
      });
    }

  } catch (error) {
    console.error("Error in /data endpoint:", error);
    res.status(500).json({ 
      error: "Internal server error", 
      message: error.message 
    });
  }
});

// GET all available routes
app.get("/routes", (req, res) => {
  const routes = [
    { method: "GET", path: "/", description: "Server status" },
    { method: "GET", path: "/health", description: "Health check" },
    { method: "GET", path: "/routes", description: "List all available routes" },
    { method: "POST", path: "/data", description: "Save new data (requires: value1, value2, value3)" },
    { method: "GET", path: "/data", description: "Get all data (query params: limit, orderBy, order)" },
    { method: "GET", path: "/data/:id", description: "Get data by ID" },
    { method: "GET", path: "/data/latest", description: "Get latest data record" },
    { method: "GET", path: "/data/range", description: "Get data by date range (query params: startDate, endDate, limit)" },
    { method: "DELETE", path: "/data/:id", description: "Delete data by ID" }
  ];
  
  res.status(200).json({ 
    message: "Available API routes", 
    routes: routes,
    baseUrl: `http://localhost:${PORT}`
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server is listening on port ${PORT}`);
  console.log(`📊 API Documentation: http://localhost:${PORT}/routes`);
  console.log(`❤️  Health check: http://localhost:${PORT}/health`);
  console.log(`📝 Data endpoints:`);
  console.log(`   POST /data - Save data`);
  console.log(`   GET  /data - Get all data`);
  console.log(`   GET  /data/latest - Get latest data`);
  console.log(`   GET  /data/:id - Get data by ID`);
  console.log(`   GET  /data/range - Get data by date range`);
  console.log(`   DELETE /data/:id - Delete data by ID`);
});