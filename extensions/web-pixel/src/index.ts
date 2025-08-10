import {register} from "@shopify/web-pixels-extension";

let eventBuffer: any[] = [];
let sessionId: string = '';
let userId: string = '';
let eventStats = {
  totalEvents: 0,
  sessionStart: Date.now(),
  eventCounts: {} as { [key: string]: number }
};

const BUFFER_SIZE = 10;
const FLUSH_INTERVAL = 5000;

interface EventData {
  sessionId: string;
  userId: string;
  timestamp: number;
  eventType: string;
  data: any;
  url: string;
  userAgent: string;
}

register(({ analytics, browser, init, settings }) => {
  try {
    sessionId = generateSessionId();
    userId = getUserId();

    console.log('Vakaru Pixel Extension Started', {
      sessionId: sessionId.substring(0, 20) + '...',
      userId,
      accountId: settings?.accountID,
      timestamp: new Date().toISOString()
    });

    setInterval(flushEventBuffer, FLUSH_INTERVAL);

    trackEvent('pixel_initialized', {
      accountId: settings?.accountID,
      userAgent: navigator.userAgent,
      timestamp: Date.now()
    });

    analytics.subscribe('page_viewed', (event) => {
      trackEvent('page_viewed', {
        title: event.context?.document?.title,
        url: event.context?.document?.location?.href,
        referrer: event.context?.document?.referrer,
        timestamp: event.timestamp,
        path: event.context?.document?.location?.pathname
      });
    });

    analytics.subscribe('product_viewed', (event) => {
      trackEvent('product_viewed', {
        productId: event.data?.productVariant?.product?.id,
        variantId: event.data?.productVariant?.id,
        productTitle: event.data?.productVariant?.product?.title,
        productType: event.data?.productVariant?.product?.type,
        vendor: event.data?.productVariant?.product?.vendor,
        price: event.data?.productVariant?.price?.amount,
        currency: event.data?.productVariant?.price?.currencyCode,
        timestamp: event.timestamp
      });
    });

    analytics.subscribe('product_added_to_cart', (event) => {
      trackEvent('product_added_to_cart', {
        productId: event.data?.cartLine?.merchandise?.product?.id,
        variantId: event.data?.cartLine?.merchandise?.id,
        quantity: event.data?.cartLine?.quantity,
        price: event.data?.cartLine?.cost?.totalAmount?.amount,
        cartId: event.data?.cartLine?.merchandise?.product?.id,
        timestamp: event.timestamp
      });
    });

    analytics.subscribe('product_removed_from_cart', (event) => {
      trackEvent('product_removed_from_cart', {
        productId: event.data?.cartLine?.merchandise?.product?.id,
        variantId: event.data?.cartLine?.merchandise?.id,
        quantity: event.data?.cartLine?.quantity,
        timestamp: event.timestamp
      });
    });

    analytics.subscribe('search_submitted', (event) => {
      trackEvent('search_submitted', {
        searchTerm: event.data?.searchResult?.query,
        resultsCount: event.data?.searchResult?.productVariants?.length,
        timestamp: event.timestamp
      });
    });

    analytics.subscribe('checkout_started', (event) => {
      trackEvent('checkout_started', {
        checkoutToken: event.data?.checkout?.token,
        totalPrice: event.data?.checkout?.totalPrice?.amount,
        currency: event.data?.checkout?.totalPrice?.currencyCode,
        lineItemsCount: event.data?.checkout?.lineItems?.length,
        timestamp: event.timestamp
      });
    });

    analytics.subscribe('payment_info_submitted', (event) => {
      trackEvent('payment_info_submitted', {
        checkoutToken: event.data?.checkout?.token,
        timestamp: event.timestamp
      });
    });

    analytics.subscribe('checkout_completed', (event) => {
      trackEvent('checkout_completed', {
        orderId: event.data?.checkout?.order?.id,
        totalPrice: event.data?.checkout?.totalPrice?.amount,
        currency: event.data?.checkout?.totalPrice?.currencyCode,
        timestamp: event.timestamp
      });
    });

    document.addEventListener('visibilitychange', () => {
      const now = Date.now();
      if (document.hidden) {
        trackEvent('page_hidden', { timestamp: now });
      } else {
        trackEvent('page_visible', { timestamp: now });
      }
    });

    window.addEventListener('beforeunload', () => {
      const timeOnPage = Date.now() - eventStats.sessionStart;
      trackEvent('page_exit', {
        timeOnPage,
        timestamp: Date.now()
      });
      flushEventBuffer();
    });

    console.log('All event listeners registered successfully');

  } catch (error) {
    console.error('Failed to initialize Vakaru Pixel Extension:', error);
  }
});

function trackEvent(eventType: string, data: any) {
  try {
    const eventData: EventData = {
      sessionId,
      userId,
      timestamp: Date.now(),
      eventType,
      data,
      url: window.location.href,
      userAgent: navigator.userAgent
    };

    eventBuffer.push(eventData);
    eventStats.totalEvents++;
    eventStats.eventCounts[eventType] = (eventStats.eventCounts[eventType] || 0) + 1;

    console.log(`[Vakaru] ${eventType}:`, {
      ...data,
      session: sessionId.substring(0, 15) + '...',
      eventCount: eventStats.totalEvents
    });

    if (eventBuffer.length >= BUFFER_SIZE) {
      flushEventBuffer();
    }
  } catch (error) {
    console.error('Failed to track event:', eventType, error);
  }
}

function flushEventBuffer() {
  if (eventBuffer.length === 0) return;

  try {
    console.log(`[Vakaru] Flushing ${eventBuffer.length} events:`, {
      batchSize: eventBuffer.length,
      sessionStats: {
        totalEvents: eventStats.totalEvents,
        sessionDuration: Math.round((Date.now() - eventStats.sessionStart) / 1000) + 's',
        topEvents: Object.entries(eventStats.eventCounts)
          .sort(([,a], [,b]) => b - a)
          .slice(0, 3)
          .map(([event, count]) => `${event}: ${count}`)
      },
      events: eventBuffer.map(e => ({
        type: e.eventType,
        timestamp: new Date(e.timestamp).toLocaleTimeString(),
        key_data: extractKeyData(e.data)
      }))
    });

    simulateEventIngestion(eventBuffer);
    eventBuffer = [];
  } catch (error) {
    console.error('Failed to flush event buffer:', error);
  }
}

function simulateEventIngestion(events: EventData[]) {
  const payload = {
    batch_id: Math.random().toString(36).substr(2, 9),
    session_id: sessionId,
    user_id: userId,
    timestamp: Date.now(),
    events: events,
    metadata: {
      source: 'shopify_web_pixel',
      version: '1.0.0',
      store_domain: window.location.hostname
    }
  };

  console.log('[Vakaru] Simulated API call:', {
    endpoint: 'https://api.vakaru.com/events/ingest',
    method: 'POST',
    payload_size: JSON.stringify(payload).length + ' bytes',
    event_count: events.length
  });
}

function extractKeyData(data: any): any {
  const keyFields = ['productTitle', 'searchTerm', 'totalPrice', 'currency', 'quantity', 'orderId'];
  const result: any = {};

  keyFields.forEach(field => {
    if (data && data[field] !== undefined) {
      result[field] = data[field];
    }
  });

  return Object.keys(result).length > 0 ? result : 'event_captured';
}

function generateSessionId(): string {
  return 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
}

function getUserId(): string {
  let storedUserId = 'user_' + Math.random().toString(36).substr(2, 9);

  try {
    const stored = localStorage.getItem('vakaru_user_id');
    if (stored) {
      storedUserId = stored;
    } else {
      localStorage.setItem('vakaru_user_id', storedUserId);
    }
  } catch (e) {
    console.log('Using session-only user ID (localStorage not available)');
  }

  return storedUserId;
}

(window as any).vakaruPixel = {
  sessionId,
  stats: () => eventStats,
  flush: () => flushEventBuffer(),
  test: () => trackEvent('manual_test', { triggered: 'manually', timestamp: Date.now() })
};

console.log('Vakaru Pixel loaded. Debug with: window.vakaruPixel.test()');
