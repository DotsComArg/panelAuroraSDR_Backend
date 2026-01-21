import { MongoClient, MongoClientOptions, Db } from "mongodb";

let cachedClient: MongoClient | null = null;
let cachedDb: Db | null = null;

export async function getMongoDb(): Promise<Db> {
  if (cachedDb) {
    return cachedDb;
  }

  const uri = process.env.MONGODB_URI || "mongodb+srv://admin:admin@cluster01.pxbkzd4.mongodb.net/";
  const dbName = process.env.MONGODB_DB || "AuroraSDR";

  if (!uri) {
    throw new Error("Falta la variable de entorno MONGODB_URI");
  }

  if (cachedClient) {
    cachedDb = cachedClient.db(dbName);
    return cachedDb;
  }

  const options: MongoClientOptions = {};
  const client = new MongoClient(uri, options);
  await client.connect();

  cachedClient = client;
  cachedDb = client.db(dbName);
  return cachedDb;
}

export async function getMongoClient(): Promise<MongoClient> {
  if (cachedClient) {
    return cachedClient;
  }
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("Falta la variable de entorno MONGODB_URI");
  }
  const client = new MongoClient(uri);
  await client.connect();
  cachedClient = client;
  return client;
}


