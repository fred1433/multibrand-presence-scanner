// What a page carries that bears on turning a lead into a booking: the
// measurement identifiers present, the ways a lead can enter, and where a form
// or a call appears to go. Nothing else is collected: this is not a pixel
// inventory and not a compliance score.
//
// Every detector is a declared pattern. A pattern that matches proves the
// string is in the page as served, and nothing more: whether a tag then fires,
// and where its data lands, is not observable from outside and is reported as
// something to verify.

import { finding } from '../evidence.js';

export const DETECTORS = [
  // --- measurement identifiers ---
  {
    id: 'ga4', label: 'Google Analytics 4 measurement ID', category: 'measurement',
    re: /\bG-[A-Z0-9]{8,12}\b/g,
    context: ['gtag', 'googletagmanager', 'google-analytics', 'dataLayer', 'gtm.js'],
  },
  {
    id: 'universal_analytics', label: 'Universal Analytics identifier', category: 'measurement',
    re: /\bUA-\d{4,10}-\d{1,4}\b/g,
    historical: true,
  },
  {
    id: 'gtm', label: 'Tag Manager container', category: 'measurement',
    re: /\bGTM-[A-Z0-9]{6,9}\b/g,
  },
  {
    id: 'google_ads', label: 'Google Ads measurement ID', category: 'measurement',
    re: /\bAW-\d{9,13}\b/g,
  },
  {
    id: 'google_ads_conversion', label: 'Google Ads conversion label', category: 'measurement',
    re: /\bAW-\d{9,13}\/[A-Za-z0-9_-]{6,}/g,
  },
  // --- where a call might be measured ---
  {
    id: 'callrail', label: 'CallRail', category: 'call_handling',
    re: /cdn\.callrail\.com\/companies\/(\d+)\//g, captureGroup: 1,
  },
  {
    id: 'calltrackingmetrics', label: 'CallTrackingMetrics', category: 'call_handling',
    re: /(?:tctm\.co|\.calltrackingmetrics\.com)\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'whatconverts', label: 'WhatConverts', category: 'call_handling',
    re: /whatconverts\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'invoca', label: 'Invoca', category: 'call_handling',
    re: /solutions\.invocacdn\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'marchex', label: 'Marchex', category: 'call_handling',
    re: /(?:marchex\.io|voicestar\.com)\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'ringba', label: 'Ringba', category: 'call_handling',
    re: /js\.ringba\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'twilio', label: 'Twilio in the page', category: 'call_handling',
    re: /(?:sdk\.twilio\.com|twil\.io|taskrouter\.twilio)[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  // --- how a lead can enter, and where it appears to go ---
  {
    id: 'gravity_forms', label: 'Gravity Forms', category: 'form',
    re: /gform_wrapper|gravityforms\/(?:js|css)/g, quiet: true,
  },
  {
    id: 'contact_form_7', label: 'Contact Form 7', category: 'form',
    re: /wpcf7(?:-form|_contact_form|\/includes)/g, quiet: true,
  },
  {
    id: 'wpforms', label: 'WPForms', category: 'form',
    re: /wpforms(?:-form|\/assets)/g, quiet: true,
  },
  {
    id: 'ninja_forms', label: 'Ninja Forms', category: 'form',
    re: /ninja-forms\/(?:js|assets)/g, quiet: true,
  },
  {
    id: 'formidable', label: 'Formidable Forms', category: 'form',
    re: /formidable\/(?:js|css)/g, quiet: true,
  },
  {
    id: 'jotform', label: 'Jotform', category: 'form',
    re: /(?:form|cdn)\.jotform\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'typeform', label: 'Typeform', category: 'form',
    re: /embed\.typeform\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'hubspot_forms', label: 'HubSpot Forms', category: 'lead_destination',
    re: /js\.hsforms\.net\/forms\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'hubspot', label: 'HubSpot', category: 'lead_destination',
    re: /js\.hs-scripts\.com\/(\d{4,12})\.js/g, captureGroup: 1,
  },
  {
    id: 'salesforce_web_to_lead', label: 'Salesforce web-to-lead', category: 'lead_destination',
    re: /webto\.salesforce\.com\/servlet\/servlet\.WebToLead/g, quiet: true,
  },
  {
    id: 'zoho', label: 'Zoho', category: 'lead_destination',
    re: /(?:crm\.zoho\.com|forms\.zohopublic\.com|salesiq\.zoho)[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'activecampaign', label: 'ActiveCampaign', category: 'lead_destination',
    re: /[a-z0-9-]+\.activehosted\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'klaviyo', label: 'Klaviyo', category: 'lead_destination',
    re: /static\.klaviyo\.com\/onsite\/js\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'mailchimp', label: 'Mailchimp', category: 'lead_destination',
    re: /(?:chimpstatic\.com|list-manage\.com)\/[A-Za-z0-9_\-/.?=&]*/g, quiet: true,
  },
  {
    id: 'smartmoving', label: 'SmartMoving', category: 'lead_destination',
    re: /(?:app\.)?smartmoving\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'supermove', label: 'Supermove', category: 'lead_destination',
    re: /supermove\.co\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'moveitpro', label: 'MoveitPro', category: 'lead_destination',
    re: /moveitpro\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'elromco', label: 'Elromco', category: 'lead_destination',
    re: /elromco\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'movegistics', label: 'Movegistics', category: 'lead_destination',
    re: /movegistics\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  // --- chat, which is a third way in ---
  {
    id: 'podium', label: 'Podium', category: 'chat',
    re: /connect\.podium\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'birdeye', label: 'Birdeye', category: 'chat',
    re: /(?:birdeye\.com|bcdn\.birdeye\.com)\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'tawk', label: 'Tawk.to', category: 'chat',
    re: /embed\.tawk\.to\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'intercom', label: 'Intercom', category: 'chat',
    re: /widget\.intercom\.io\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'drift', label: 'Drift', category: 'chat',
    re: /js\.driftt\.com\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
  {
    id: 'tidio', label: 'Tidio', category: 'chat',
    re: /code\.tidio\.co\/[A-Za-z0-9_\-/.]*/g, quiet: true,
  },
];

const CONTEXT_WINDOW = 400;

function hasContext(html, index, words) {
  const from = Math.max(0, index - CONTEXT_WINDOW);
  const slice = html.slice(from, index + CONTEXT_WINDOW).toLowerCase();
  return words.some((w) => slice.includes(w.toLowerCase()));
}

/** Run every detector over one page, keeping the literal proof of each hit. */
export function detectTags(html, pageUrl) {
  const results = {};
  for (const d of DETECTORS) {
    const re = new RegExp(d.re.source, d.re.flags.includes('g') ? d.re.flags : d.re.flags + 'g');
    let m;
    const byValue = new Map();
    while ((m = re.exec(html)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (d.context && !hasContext(html, m.index, d.context)) continue;
      const value = d.captureGroup ? m[d.captureGroup] : (d.quiet ? d.label : m[0]);
      if (byValue.has(value)) continue;
      byValue.set(value, finding({ value, url: pageUrl, source: html, index: m.index, length: m[0].length }));
      if (byValue.size >= 6) break;
    }
    if (byValue.size === 0) continue;
    results[d.id] = {
      id: d.id,
      label: d.label,
      category: d.category,
      historical: d.historical === true,
      ids: [...byValue.keys()],
      findings: [...byValue.values()],
    };
  }
  return results;
}

/** Merge per-page detections into one per-brand view, keeping every proof. */
export function mergeTagResults(perPage) {
  const merged = {};
  for (const { url, tags } of perPage) {
    for (const [id, r] of Object.entries(tags)) {
      const target = (merged[id] ??= { ...r, ids: [], findings: [], pages: [] });
      for (const v of r.ids) if (!target.ids.includes(v)) target.ids.push(v);
      for (const f of r.findings) {
        if (!target.findings.some((x) => x.value === f.value && x.evidence_url === f.evidence_url)) target.findings.push(f);
      }
      if (!target.pages.includes(url)) target.pages.push(url);
    }
  }
  return merged;
}
