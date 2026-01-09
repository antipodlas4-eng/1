# Replit.md

## Overview

This is a simple property management application built with Node.js and Express. The app allows users to track rental properties, including rent amounts, payment status, arrears calculations, and utility information. It uses server-side rendering with EJS templates and stores data in memory.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Backend Framework
- **Express.js** serves as the web framework
- Server runs on port 5000 (or PORT environment variable)
- Uses body-parser middleware for form data processing

### Templating
- **EJS** (Embedded JavaScript) for server-side HTML rendering
- Views stored in `./views` directory
- Static files served from `./public` directory

### Data Storage
- Currently uses **in-memory array** (`properties`) for data storage
- No persistent database - data resets on server restart
- This is a key limitation that may need addressing for production use

### Routes
- `GET /` - Renders the main page with property listings
- `POST /add` - Adds a new property with rent tracking

### Data Model (Property)
Properties contain:
- `name` - Property identifier
- `rentAmount` - Monthly rent value
- `rentPaid` - Boolean for current month payment status
- `lastMonthPaid` - Boolean for previous month payment status
- `arrears` - Calculated unpaid amount (sum of missed payments)
- `utilities` - Utility information (defaults to "brak danych" / "no data" in Polish)

## External Dependencies

### NPM Packages
- **express** (latest) - Web application framework
- **body-parser** (latest) - Request body parsing middleware
- **ejs** (^3.1.10) - Templating engine

### External Services
- None currently integrated

### Database
- None - uses in-memory storage only