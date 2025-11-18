const express = require("express");
const app = express();
const cors = require("cors");
const { google } = require("googleapis");
require("dotenv").config();
const { initializeApp, cert } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const PORT = process.env.PORT || 3000;

initializeApp({
  credential: cert({
    projectId: process.env.PROJECT_ID,
    clientEmail: process.env.CLIENT_EMAIL,
    privateKey: process.env.RSA.replace(/\\n/g, '\n')
  }),
});

const db = getFirestore();

app.use(cors());
app.use(express.json());

const SHEET_ID = process.env.SHEET_ID;
const COLLECTION = "dataStore";
const EMAIL = process.env.EMAIL;
const POND_ID = "pond1";
const SYSTEM_ID = "system1";
const SCOPES = ["https://www.googleapis.com/auth/spreadsheets"];

const sheets = google.sheets({ version: "v4" });

app.get("/", async (req, res) => {
  res.status(200).send("Main");
});

app.get("/test", (req, res) => {
  console.log("coming");
  res.status(200).json({ message: "Hello, world!" });
});

function getTimestampString() {
  const date = new Date();

  // IST offset is +5:30 from UTC
  const ISTOffset = 5.5 * 60 * 60 * 1000; // 5.5 hours in milliseconds
  const offsetDate = new Date(date.getTime() + ISTOffset);

  // Extract the year, month, day, hours, minutes, and seconds in IST
  const year = offsetDate.getUTCFullYear();
  const month = String(offsetDate.getUTCMonth() + 1).padStart(2, "0"); // Add leading zero for single-digit months
  const day = String(offsetDate.getUTCDate()).padStart(2, "0"); // Add leading zero for single-digit days
  const hours = String(offsetDate.getUTCHours()).padStart(2, "0");
  const minutes = String(offsetDate.getUTCMinutes()).padStart(2, "0");
  const seconds = String(offsetDate.getUTCSeconds()).padStart(2, "0");

  return `${year}:${month}:${day} ${hours}:${minutes}:${seconds}`;
}

function rgen(a, b) {
  return Math.random() * (b - a) + a;
}

const obtainValues = (rb) => {
  // Accept multiple possible key names from various sensor payloads
  const DO = rb.DO ?? rb.Do ?? rb.do ?? null;
  const Temp = rb.temperature ?? rb.temp ?? rb.Temp ?? rb.TempC ?? null;
  const pH = rb.pH ?? rb.ph ?? null;
  const Conduct = rb.conductivity ?? rb.conduct ?? rb.tds ?? rb.Conduct ?? null;

  return {
    DO: DO != null ? DO : 0.01,
    Temp: Temp != null ? Temp : 0.01,
    pH: pH != null ? pH : 0.01,
    Conduct: Conduct != null ? Conduct : 0.01,
  };
}

const sendDataToFirestore = async (DO, Temp, pH, Conduct) => {
  const timestamp = new Date();

  let newFormat = getTimestampString();
  try {
    await db
      .collection(COLLECTION)
      .doc(EMAIL)
      .collection(POND_ID)
      .doc(SYSTEM_ID)
      .set(
        {
          [newFormat]: {
            DO: DO,
            TEMP: Temp,
            PH: pH,
            TDS: Conduct,
          },
        },
        { merge: true }
      );

    await db
      .collection(COLLECTION)
      .doc(EMAIL)
      .set(
        {
          system1: {
            DO: DO,
            TEMP: Temp,
            PH: pH,
            TDS: Conduct,
          },
        },
        { merge: true }
      );

    console.log("Data sent to Firestore");
  } catch (error) {
    console.log("Error in storing: ", error);
  }
};

// Helper to update the 'ponds' collection which the mobile app reads from
const updatePondsCollection = async (DO, Temp, pH, Conduct) => {
  try {
    await db.collection('ponds').doc(POND_ID).set({
      Do: DO,
      temperature: Temp,
      pH: pH,
      Tds: Conduct,
      Turbidity: 0.01,
      Nitrate: 0.01,
      timestamp: new Date()
    }, { merge: true });
    console.log('Updated ponds collection for', POND_ID);
  } catch (err) {
    console.log('Error updating ponds collection:', err);
  }
}

var canSaveToFirestore = false;

// const firestoreSaveInterval = setInterval(() => {
//     // console.log("initial");
//     if (!canSaveToFirestore) canSaveToFirestore = true;
// }, 30 * 1000);

var count = 0;

var latestValues = {
  DO: null, Temp: null, pH: null, Conduct: null, time: null
};

setInterval(() => {
  const timeNow = Date.now();
  const timeOfLatestData = latestValues.time;
  const timeDifference = (timeOfLatestData - timeNow);
  if (!timeOfLatestData || (timeOfLatestData != null && (timeDifference > (1000 * 60 * 20)))) 
    return sendDataToFirestore(0.01, 0.01, 0.01, 0.01);
}, 1000 * 60 * 20);

setInterval(() => {
  canSaveToFirestore = true;
}, 1000 * 60 * 10);

app.post("/sensor-data", async (req, res) => {
  const rb = req.body;
  const { DO, Temp, pH, Conduct } = obtainValues(rb);

  latestValues.DO = DO;
  latestValues.Temp = Temp;
  latestValues.pH = pH;
  latestValues.Conduct = Conduct;
  latestValues.time = Date.now();

  console.log(req.body);
  try {
    const auth = new google.auth.GoogleAuth({
      // keyFile: "./pond-quality-5325c66d5988.json",
      scopes: SCOPES,
      credentials: { projectId: process.env.PROJECT_ID, client_email: process.env.CLIENT_EMAIL, private_key: process.env.RSA.replace(/\\n/g, '\n') }
    });
    const client = await auth.getClient();

    google.options({ auth: client });

    const timestamp = new Date().toLocaleString(undefined, {
      timeZone: "Asia/Kolkata",
    });

    // unattended raw data
    sheets.spreadsheets.values
      .append({
        spreadsheetId: process.env.SHEET_RAW_ID,
        range: `Sheet1!A:E`,
        valueInputOption: "USER_ENTERED",
        requestBody: {
          values: [[timestamp, DO, Temp, pH, Conduct]],
        },
      })
      .then((res) => {
        if (res.status != 200) return console.log("Couldn't save actual data");
        console.log(
          `Raw excel saved at ${new Date().toLocaleString(undefined, {
            timeZone: "Asia/Kolkata",
          })}:`,
          res.statusText
        );
      })
      .catch((err) => {
        console.log(
          `Something screwed up when saving raw @${new Date().toLocaleString(
            undefined,
            {
              timeZone: "Asia/Kolkata",
            }
          )}`
        );
        console.log(err);
      });

    // OG sheet to send data
    const data = await sheets.spreadsheets.values.append({
      spreadsheetId: SHEET_ID,
      range: `Sheet1!A:E`,
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          // [(new Date().toLocaleDateString()) + ' ' + (new Date().toLocaleTimeString()), DO, Temp, pH, Conduct]
          [timestamp, DO, Temp, pH, Conduct],
        ],
      },
    });
    // count++;

    if (canSaveToFirestore) {
      canSaveToFirestore = false;
      await sendDataToFirestore(DO, Temp, pH, Conduct);
      console.log("Firestore data sent:",new Date().toLocaleString(undefined, {
        timeZone: "Asia/Kolkata",
      }));
    }

    // Always update the 'ponds' document so the mobile app sees latest values immediately
    await updatePondsCollection(DO, Temp, pH, Conduct);

    console.log(
      `🚀 ${new Date().toLocaleString(undefined, {
        timeZone: "Asia/Kolkata",
      })}:`,
      data.statusText
    );

    if (!data.status == 200) throw new Error("Error in Google Sheets update!");
    res.status(200).json({ message: "Data saved!" });
  } catch (error) {
    console.log("🚀 ~ app.post ~ error:", error);
    res.status(500).send("Unable to save data");
    // clearInterval(firestoreSaveInterval);
    count = 0;
  }
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});
