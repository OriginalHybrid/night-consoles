#!/usr/bin/env python3
"""Bake TIDAL-3 neural-network data.

- MLP: a real NumPy training run on synthetic 4-class data.
- CNN / Transformer: deterministic simulated architecture graphs and metrics.
Everything is CPU-only and reproducible. No external data or network access.
"""
import json
import math
import os
import numpy as np

OUT = os.path.join(os.path.dirname(__file__), "..", "..", "shared", "data", "tidal-3", "models.json")
OUT = os.path.abspath(OUT)
os.makedirs(os.path.dirname(OUT), exist_ok=True)
rng = np.random.default_rng(7)


def softmax(z):
    z = z - z.max(axis=1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=1, keepdims=True)


def train_mlp(steps=320):
    n, d, h1, h2, k = 2048, 8, 24, 12, 4
    X = rng.normal(size=(n, d)).astype(np.float64)
    y = ((X[:, 0] + 0.7 * X[:, 1] > 0).astype(int) + 2 * (X[:, 2] + 0.4 * X[:, 3] > 0).astype(int))
    W1 = rng.normal(scale=0.32, size=(d, h1)); b1 = np.zeros(h1)
    W2 = rng.normal(scale=0.24, size=(h1, h2)); b2 = np.zeros(h2)
    W3 = rng.normal(scale=0.20, size=(h2, k)); b3 = np.zeros(k)
    series = {"loss": [], "lr": [], "grad": [], "acc": [], "latency": []}
    batch = 64
    for step in range(1, steps + 1):
        idx = rng.integers(0, n, batch)
        xb, yb = X[idx], y[idx]
        a1 = np.maximum(0, xb @ W1 + b1)
        a2 = np.maximum(0, a1 @ W2 + b2)
        out = a2 @ W3 + b3
        p = softmax(out)
        loss = -np.log(p[np.arange(batch), yb] + 1e-9).mean()
        # backward
        dout = p.copy(); dout[np.arange(batch), yb] -= 1; dout /= batch
        dW3 = a2.T @ dout; db3 = dout.sum(0)
        da2 = dout @ W3.T; da2[a2 <= 0] = 0
        dW2 = a1.T @ da2; db2 = da2.sum(0)
        da1 = da2 @ W2.T; da1[a1 <= 0] = 0
        dW1 = xb.T @ da1; db1 = da1.sum(0)
        lr = 0.06 * 0.5 * (1 + math.cos(math.pi * step / steps)) + 0.0015
        gn = math.sqrt(float((dW1 ** 2).sum() + (dW2 ** 2).sum() + (dW3 ** 2).sum()))
        for W, b, dW, db in ((W1, b1, dW1, db1), (W2, b2, dW2, db2), (W3, b3, dW3, db3)):
            W -= lr * dW; b -= lr * db
        acc = float((p.argmax(1) == yb).mean())
        series["loss"].append(round(float(loss), 5))
        series["lr"].append(round(float(lr), 6))
        series["grad"].append(round(gn, 4))
        series["acc"].append(round(acc, 4))
        series["latency"].append(round(1.2 + 0.15 * math.sin(step / 7) + 0.05 * rng.random(), 3))
    # final activations / gradients on the full set
    a1 = np.maximum(0, X @ W1 + b1)
    a2 = np.maximum(0, a1 @ W2 + b2)
    out = a2 @ W3 + b3
    p = softmax(out)
    def hist(W, bins=16):
        h, edges = np.histogram(W.ravel(), bins=bins, range=(-0.8, 0.8))
        return [int(v) for v in h]
    layers = [
        {"id": "input", "label": "INPUT", "type": "input", "params": d, "activation": 0.92, "gradient": 0.0},
        {"id": "dense1", "label": "DENSE-1", "type": "dense", "params": d * h1 + h1, "activation": float(np.abs(a1).mean()), "gradient": float(np.abs(dW1).mean())},
        {"id": "dense2", "label": "DENSE-2", "type": "dense", "params": h1 * h2 + h2, "activation": float(np.abs(a2).mean()), "gradient": float(np.abs(dW2).mean())},
        {"id": "output", "label": "OUTPUT", "type": "output", "params": h2 * k + k, "activation": float(np.abs(out).mean()), "gradient": float(np.abs(dW3).mean())},
    ]
    edges = [
        {"src": "input", "dst": "dense1", "type": "dense", "weight": float(np.linalg.norm(W1)), "activation": float(np.abs(a1).mean()), "gradient": float(np.abs(dW1).mean())},
        {"src": "dense1", "dst": "dense2", "type": "dense", "weight": float(np.linalg.norm(W2)), "activation": float(np.abs(a2).mean()), "gradient": float(np.abs(dW2).mean())},
        {"src": "dense2", "dst": "output", "type": "dense", "weight": float(np.linalg.norm(W3)), "activation": float(np.abs(out).mean()), "gradient": float(np.abs(dW3).mean())},
    ]
    weights = [
        {"layer": "W1", "norm": float(np.linalg.norm(W1)), "sparsity": float((np.abs(W1) < 0.05).mean()), "hist": hist(W1)},
        {"layer": "W2", "norm": float(np.linalg.norm(W2)), "sparsity": float((np.abs(W2) < 0.05).mean()), "hist": hist(W2)},
        {"layer": "W3", "norm": float(np.linalg.norm(W3)), "sparsity": float((np.abs(W3) < 0.05).mean()), "hist": hist(W3)},
    ]
    return layers, edges, series, weights, float(loss), float(acc)


def sim_series(start_loss, end_loss, start_acc, end_acc, steps=260, seed=11, base_lat=2.4):
    r = np.random.default_rng(seed)
    s = np.linspace(0, 1, steps)
    loss = end_loss + (start_loss - end_loss) * np.exp(-3.1 * s) + r.normal(0, 0.012, steps)
    acc = start_acc + (end_acc - start_acc) * (1 - np.exp(-3.4 * s)) + r.normal(0, 0.006, steps)
    lr = 0.0009 * 0.5 * (1 + np.cos(np.pi * s)) + 0.00002
    grad = 2.4 * np.exp(-2.2 * s) + 0.08 + r.normal(0, 0.02, steps)
    lat = base_lat + 0.22 * np.sin(np.arange(steps) / 8) + r.normal(0, 0.05, steps)
    return {
        "loss": [round(float(v), 5) for v in loss],
        "lr": [round(float(v), 7) for v in lr],
        "grad": [round(float(v), 4) for v in grad],
        "acc": [round(float(min(0.995, max(0, v))), 4) for v in acc],
        "latency": [round(float(v), 3) for v in lat],
    }


def sim_weights(seed, layers=4):
    r = np.random.default_rng(seed)
    out = []
    for i in range(layers):
        W = r.normal(0, 0.18 + i * 0.02, 4000)
        h, _ = np.histogram(W, bins=16, range=(-0.8, 0.8))
        out.append({"layer": "L%d" % (i + 1), "norm": float(np.linalg.norm(W)), "sparsity": float((np.abs(W) < 0.05).mean()), "hist": [int(v) for v in h]})
    return out


mlp_layers, mlp_edges, mlp_series, mlp_weights, mlp_loss, mlp_acc = train_mlp()

cnn_layers = [
    {"id": "input", "label": "INPUT 32²", "type": "input", "params": 1024, "activation": 0.88, "gradient": 0.0},
    {"id": "conv1", "label": "CONV-1 16", "type": "conv", "params": 160, "activation": 0.54, "gradient": 0.021},
    {"id": "pool1", "label": "POOL-1", "type": "pool", "params": 0, "activation": 0.41, "gradient": 0.018},
    {"id": "conv2", "label": "CONV-2 32", "type": "conv", "params": 4640, "activation": 0.37, "gradient": 0.014},
    {"id": "pool2", "label": "POOL-2", "type": "pool", "params": 0, "activation": 0.29, "gradient": 0.011},
    {"id": "fc", "label": "FC-128", "type": "dense", "params": 18496, "activation": 0.22, "gradient": 0.009},
    {"id": "output", "label": "OUTPUT 10", "type": "output", "params": 1290, "activation": 0.14, "gradient": 0.006},
]
cnn_edges = [
    {"src": "input", "dst": "conv1", "type": "conv", "weight": 1.42, "activation": 0.54, "gradient": 0.021},
    {"src": "conv1", "dst": "pool1", "type": "pool", "weight": 0.72, "activation": 0.41, "gradient": 0.018},
    {"src": "pool1", "dst": "conv2", "type": "conv", "weight": 1.18, "activation": 0.37, "gradient": 0.014},
    {"src": "conv2", "dst": "pool2", "type": "pool", "weight": 0.61, "activation": 0.29, "gradient": 0.011},
    {"src": "pool2", "dst": "fc", "type": "dense", "weight": 0.94, "activation": 0.22, "gradient": 0.009},
    {"src": "fc", "dst": "output", "type": "dense", "weight": 0.38, "activation": 0.14, "gradient": 0.006},
    {"src": "conv1", "dst": "conv2", "type": "skip", "weight": 0.22, "activation": 0.10, "gradient": 0.004},
]
cnn_series = sim_series(2.31, 0.42, 0.18, 0.913, seed=21, base_lat=3.1)

tr_layers = [
    {"id": "tokens", "label": "TOKENS 128", "type": "input", "params": 128, "activation": 0.91, "gradient": 0.0},
    {"id": "embed", "label": "EMBED 128", "type": "embed", "params": 16384, "activation": 0.62, "gradient": 0.017},
    {"id": "mha1", "label": "MHA-1 · 4H", "type": "attention", "params": 65536, "activation": 0.48, "gradient": 0.012},
    {"id": "ffn1", "label": "FFN-1 512", "type": "ffn", "params": 131072, "activation": 0.39, "gradient": 0.010},
    {"id": "mha2", "label": "MHA-2 · 4H", "type": "attention", "params": 65536, "activation": 0.31, "gradient": 0.008},
    {"id": "ffn2", "label": "FFN-2 512", "type": "ffn", "params": 131072, "activation": 0.25, "gradient": 0.006},
    {"id": "head", "label": "HEAD", "type": "head", "params": 1290, "activation": 0.17, "gradient": 0.004},
    {"id": "output", "label": "OUTPUT", "type": "output", "params": 10, "activation": 0.11, "gradient": 0.002},
]
tr_edges = [
    {"src": "tokens", "dst": "embed", "type": "embed", "weight": 1.22, "activation": 0.62, "gradient": 0.017},
    {"src": "embed", "dst": "mha1", "type": "attention", "weight": 1.02, "activation": 0.48, "gradient": 0.012},
    {"src": "mha1", "dst": "ffn1", "type": "ffn", "weight": 0.88, "activation": 0.39, "gradient": 0.010},
    {"src": "ffn1", "dst": "mha2", "type": "attention", "weight": 0.71, "activation": 0.31, "gradient": 0.008},
    {"src": "mha2", "dst": "ffn2", "type": "ffn", "weight": 0.57, "activation": 0.25, "gradient": 0.006},
    {"src": "ffn2", "dst": "head", "type": "head", "weight": 0.42, "activation": 0.17, "gradient": 0.004},
    {"src": "head", "dst": "output", "type": "head", "weight": 0.24, "activation": 0.11, "gradient": 0.002},
    {"src": "embed", "dst": "mha2", "type": "residual", "weight": 0.31, "activation": 0.18, "gradient": 0.005},
    {"src": "mha1", "dst": "ffn2", "type": "residual", "weight": 0.26, "activation": 0.14, "gradient": 0.004},
]
tr_series = sim_series(2.48, 0.36, 0.12, 0.942, seed=31, base_lat=4.6)

models = [
    {
        "id": "mlp", "label": "MODEL-α", "arch": "MLP", "sub": "SYNTH-CLS · 8-16-8-4 · SGD",
        "color": "#00C8E0", "colorRgb": [0, 200, 224], "mode": "REAL",
        "nodes": mlp_layers, "edges": mlp_edges, "series": mlp_series, "weights": mlp_weights,
        "metrics": {"loss": round(mlp_loss, 5), "lr": mlp_series["lr"][-1], "grad": mlp_series["grad"][-1], "acc": round(mlp_acc, 4), "latency": mlp_series["latency"][-1], "params": 8 * 24 + 24 + 24 * 12 + 12 + 12 * 4 + 4},
        "inference": {"attention": None, "latency_ms": mlp_series["latency"][-1], "throughput": 1840},
    },
    {
        "id": "cnn", "label": "MODEL-β", "arch": "CNN", "sub": "SYNTH-VISION · 2×CONV · FC",
        "color": "#FFA040", "colorRgb": [255, 160, 64], "mode": "SIM",
        "nodes": cnn_layers, "edges": cnn_edges, "series": cnn_series, "weights": sim_weights(21, 4),
        "metrics": {"loss": round(cnn_series["loss"][-1], 5), "lr": cnn_series["lr"][-1], "grad": cnn_series["grad"][-1], "acc": cnn_series["acc"][-1], "latency": cnn_series["latency"][-1], "params": 24610},
        "inference": {"attention": None, "latency_ms": cnn_series["latency"][-1], "throughput": 960},
    },
    {
        "id": "transformer", "label": "MODEL-γ", "arch": "TRANSFORMER", "sub": "SYNTH-SEQ · 2×MHA · 4H",
        "color": "#E060B8", "colorRgb": [224, 96, 184], "mode": "SIM",
        "nodes": tr_layers, "edges": tr_edges, "series": tr_series, "weights": sim_weights(31, 5),
        "metrics": {"loss": round(tr_series["loss"][-1], 5), "lr": tr_series["lr"][-1], "grad": tr_series["grad"][-1], "acc": tr_series["acc"][-1], "latency": tr_series["latency"][-1], "params": 345600},
        "inference": {"attention": [[round(float(0.4 + 0.5 * math.exp(-abs(i - j))), 4) for j in range(8)] for i in range(8)], "latency_ms": tr_series["latency"][-1], "throughput": 420},
    },
]

data = {
    "meta": {
        "source": "TIDAL-3 neural data — NumPy real MLP + deterministic simulated CNN/Transformer",
        "note": "MLP metrics/weights are a real NumPy training run on synthetic 4-class data. CNN/Transformer graphs and metrics are simulated for the interface.",
        "generated": "2026-11-09",
        "license": "Original generated data (no external dataset).",
    },
    "models": models,
}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(data, f, separators=(",", ":"))
print("wrote", OUT, os.path.getsize(OUT), "bytes")
