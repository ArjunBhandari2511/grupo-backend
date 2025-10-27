# Grupo Backend - Twilio OTP Authentication

Simple OTP authentication using Twilio SMS for the Grupo manufacturing platform.

## 🚀 Quick Start

### 1. Install Dependencies
```bash
cd backend
npm install
```

### 2. Configure Twilio
1. Sign up at [Twilio](https://www.twilio.com/try-twilio)
2. Get credentials from [Twilio Console](https://console.twilio.com/)
3. Create `.env` file:
```env
NODE_ENV=development
PORT=5000
JWT_SECRET=your_jwt_secret_key
JWT_EXPIRES_IN=24h
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
OTP_LENGTH=6
OTP_EXPIRY_MINUTES=5
```

### 3. Start Server
```bash
npm run dev
```

## 📡 API Endpoints

- `POST /api/auth/send-otp` - Send OTP to phone number
- `POST /api/auth/verify-otp` - Verify OTP and authenticate
- `POST /api/auth/refresh-token` - Refresh JWT token
- `GET /api/auth/verify-token` - Verify token validity

## 📱 Phone Number Format
Use international format: `+[Country Code][Phone Number]`
- US: `+1234567890`
- India: `+919876543210`

## 🧪 Testing
1. Start backend: `npm run dev`
2. Start frontend: `npm run dev` (from root)
3. Go to `/buyer-portal` or `/manufacturer-portal`
4. Enter phone number → Get OTP → Enter OTP → Access dashboard

## ⚠️ Notes
- Verify your phone number in Twilio console for trial accounts
- Each SMS costs money - test responsibly
- OTP expires in 5 minutes