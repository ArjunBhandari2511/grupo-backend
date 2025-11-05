const { decodeToken } = require('./auth');

/**
 * Socket.IO authentication middleware
 * Reads token from handshake auth or Authorization header and attaches user to socket
 */
module.exports = function socketAuth(socket, next) {
  try {
    const authHeader = socket.handshake.headers.authorization;
    const tokenFromHeader = authHeader && authHeader.startsWith('Bearer ') ? authHeader.substring(7) : null;
    const tokenFromAuth = socket.handshake.auth && socket.handshake.auth.token ? socket.handshake.auth.token : null;
    const token = tokenFromAuth || tokenFromHeader;

    if (!token) {
      return next(new Error('Authentication required'));
    }

    const user = decodeToken(token);
    socket.user = user;
    return next();
  } catch (err) {
    return next(new Error('Invalid or expired token'));
  }
};


