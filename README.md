# Space Debris Collision Risk

A dashboard for tracking space objects and identifying potential satellite collision risks using publicly available orbital data.

## Problem Statement

**PS-04 — Space Debris Tracking & Satellite Collision Risk Prediction Dashboard**

The system will ingest publicly available orbital data such as TLEs, propagate object positions, detect close-approach events, calculate a risk score, and visualize potential collision risks.

## Core Features

- TLE data ingestion
- Satellite and debris object tracking
- Orbital position propagation
- Close-approach / conjunction detection
- Collision risk scoring
- 2D/3D orbital visualization
- High-risk conjunction alerts

## Project Architecture

```text
TLE Data
   ↓
Data Ingestion
   ↓
Orbital Propagation
   ↓
Conjunction Detection
   ↓
Risk Scoring
   ↓
Backend API
   ↓
Dashboard / Visualization
.
