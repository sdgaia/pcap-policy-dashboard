import express from "express";

const app = express();
app.use(express.json({ limit: "2mb" }));

const AIRTABLE_API_KEY =
  process.env.AIRTABLE || process.env.AIRTABLE_API_KEY || "";

const AIRTABLE_BASE_ID =
  process.env.AIRTABLE_BASE_ID || "app1ulAFNbDuizG4n";

const AIRTABLE_POLICIES_TABLE =
  process.env.AIRTABLE_POLICIES_TABLE || "Policies";

app.get("/", (_req, res) => {
  res.redirect("/api");
});

app.get("/api", (_req, res) => {
  res.send(`<!doctype html><html><body style="font-family:Arial;padding:40px"><h1>PCAP Policy Dashboard Active</h1><p>Renderer initialized successfully.</p></body></html>`);
});

export default app;
