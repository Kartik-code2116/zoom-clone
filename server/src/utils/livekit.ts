import { AccessToken } from 'livekit-server-sdk';

export const createLivekitToken = async (
  roomName: string,
  participantIdentity: string,
  participantName: string,
  metadata?: string
): Promise<string> => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;

  if (!apiKey || !apiSecret) {
    console.error('[LiveKit] Missing API credentials:', { 
      hasKey: !!apiKey, 
      hasSecret: !!apiSecret 
    });
    throw new Error('LiveKit API key and secret must be set in environment variables');
  }

  // Log first few chars of key for debugging (don't log full secret)
  console.log('[LiveKit] Generating token with API key:', apiKey.substring(0, 4) + '...');

  const token = new AccessToken(apiKey, apiSecret, {
    identity: participantIdentity,
    name: participantName,
    metadata,
  });

  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
  });

  const jwt = await token.toJwt();
  console.log('[LiveKit] Token generated successfully for room:', roomName);
  
  return jwt;
};
