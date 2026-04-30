import eventlet
eventlet.monkey_patch()
import os
import json
import sqlite3
import paho.mqtt.client as mqtt
from flask import Flask, jsonify
from flask_socketio import SocketIO
from flask_cors import CORS

# =========================
# 🔵 FLASK + SOCKETIO
# =========================
app = Flask(__name__)
CORS(app)

socketio = SocketIO(app, cors_allowed_origins="*")

# =========================
# 🧱 SQLITE INIT
# =========================
def init_db():
    conn = sqlite3.connect("datos.db")
    c = conn.cursor()

    c.execute("""
    CREATE TABLE IF NOT EXISTS energia (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp TEXT,
        voltaje REAL,
        corriente REAL,
        potencia REAL,
        fp REAL
    )
    """)

    conn.commit()
    conn.close()

init_db()

# =========================
# 💾 GUARDAR EN SQLITE
# =========================
def guardar_datos(data):
    conn = sqlite3.connect("datos.db")
    c = conn.cursor()

    c.execute("""
    INSERT INTO energia (timestamp, voltaje, corriente, potencia, fp)
    VALUES (datetime('now'), ?, ?, ?, ?)
    """, (
        data["voltaje"],
        data["corriente"],
        data["potencia"],
        data["fp"]
    ))

    conn.commit()
    conn.close()

# =========================
# 📊 API HISTÓRICO (REACT)
# =========================
@app.route("/historico")
def historico():
    conn = sqlite3.connect("datos.db")
    c = conn.cursor()

    c.execute("""
        SELECT timestamp, voltaje, corriente, potencia
        FROM energia
        ORDER BY id DESC
        LIMIT 50
    """)

    rows = c.fetchall()
    conn.close()

    rows.reverse()

    data = [
        {
            "time": r[0],
            "voltaje": r[1],
            "corriente": r[2],
            "potencia": r[3]
        }
        for r in rows
    ]

    return jsonify(data)

# =========================
# 📡 MQTT CALLBACKS
# =========================
def on_connect(client, userdata, flags, rc):
    print("MQTT conectado con código:", rc)
    client.subscribe("esp32/energia")

def on_message(client, userdata, msg):
    try:
        data = json.loads(msg.payload.decode())

        print("Recibido MQTT:", data)

        # 🔵 enviar a React en tiempo real
        socketio.emit("energia", data)

        # 💾 guardar en SQLite
        guardar_datos(data)

    except Exception as e:
        print("Error:", e)

# =========================
# 🔌 MQTT CLIENT
# =========================
client = mqtt.Client()
client.username_pw_set("esp32", "123456aB")
client.tls_set()

client.on_connect = on_connect
client.on_message = on_message

client.connect(
    "0b14d43a09e34ec2b9c7c2d223b6ee98.s1.eu.hivemq.cloud",
    8883
)

client.loop_start()

# =========================
# 🚀 RUN SERVER
# =========================
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
socketio.run(app, host="0.0.0.0", port=port)
