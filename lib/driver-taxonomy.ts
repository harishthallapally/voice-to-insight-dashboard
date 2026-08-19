type DriverHierarchyInput = {
  speaker?: string;
  l3Driver?: string;
  l2Driver?: string;
  l1Driver?: string;
  sentiment?: string;
  topic?: string;
  notes?: string;
  transcription?: string;
};

type DriverHierarchy = {
  l2Driver: string;
  l1Driver: string;
};

const OTHERS_DRIVER: DriverHierarchy = {
  l2Driver: "Others",
  l1Driver: "Others"
};

const VEHICLE_DRIVER: DriverHierarchy = {
  l2Driver: "Vehicle issue",
  l1Driver: "Others"
};

const CHARGER_DRIVER: DriverHierarchy = {
  l2Driver: "Charger issue",
  l1Driver: "Others"
};

function normalizeForMatch(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isAgentSpeaker(value: string) {
  return /\b(agent|advisor|executive|representative|system)\b/.test(value);
}

function isPositiveOnlyFeedback(value: string, sentiment: string) {
  const positiveSentiment = /\b(positive|satisfied|happy)\b/.test(sentiment);
  const positiveWords = /\b(good|helpful|useful|satisfied|working properly|properly working|no issue|no problem)\b/.test(
    value
  );
  const issueContext = value.replace(
    /\b(no issue|no problem|not complaining|no complaint)\b/g,
    ""
  );
  const issueWords = /\b(not|no|issue|problem|poor|slow|lag|lags|delay|failed|failure|incorrect|wrong|inaccurate|drain|disconnect|improve|improvement|error|unable|complaint|missing)\b/.test(
    issueContext
  );

  return (positiveSentiment || positiveWords) && !issueWords;
}

function hasConnectedFeatureContext(value: string) {
  return /\b(connected|connectivity|connected feature|connected features|mobile app|mobile application|app|application|smartxconnect|smart xonnect|telematics|bluetooth|bt|pairing|notification|notifications|alert|alerts|call alert|message alert|map|maps|navigation|navigate|gps|route|routing|live tracking|live location|vehicle stats|vehicle data|real time|realtime|cluster|sync|charge history|charging history|trip|otp|login|music control|subscription|multi user)\b/.test(
    value
  );
}

function hasIssueSignal(value: string) {
  if (/\b(no issue|no problem|not complaining|no complaint)\b/.test(value)) {
    return false;
  }

  return /\b(not|no|issue|problem|poor|slow|lag|lags|lagging|delay|delayed|failed|failure|incorrect|wrong|inaccurate|drain|draining|disconnect|disconnected|improve|improvement|error|unable|complaint|need|needs|required|missing|high|expensive|auto logged|not working|not connecting)\b/.test(
    value
  );
}

function hasDesiredStateIssue(value: string) {
  return (
    hasConnectedFeatureContext(value) &&
    /\b(if|should|would be good|need|needs|improve|improvement|better|required)\b/.test(
      value
    ) &&
    /\b(fast|accurate|accuracy|connect|available|work|working|display|show)\b/.test(
      value
    )
  );
}

function hasNavigationContext(value: string) {
  return /\b(map|maps|navigation|navigate|nav|route|routes|routing|direction|directions|gps)\b/.test(
    value
  );
}

function hasChargerIssueContext(value: string) {
  if (/\b(charge history|charging history)\b/.test(value)) {
    return false;
  }

  return /\b(charger|charging station|public charging|charging location|charger location|charge point|charging point|charging cable|charging adapter|home charging|portable charger|fast charging|slow charging|not charging)\b/.test(
    value
  );
}

function hasVehicleIssueContext(value: string) {
  if (
    /\b(vehicle stats|vehicle data|cluster|sync|real time|realtime|connected|connectivity|app|application|map|navigation|bluetooth|notification|alert|live tracking|live location|trip|otp|login)\b/.test(
      value
    )
  ) {
    return false;
  }

  return /\b(vehicle|two wheeler|bike|scooter|product|range|ride|brake|braking|motor|battery|pickup|speed|performance|seat|suspension|noise|vibration)\b/.test(
    value
  );
}

function classifyConnectedFeatureIssue(value: string): DriverHierarchy {
  if (/\b(live tracking|live location)\b/.test(value)) {
    if (/\b(accurate|accuracy|inaccurate|incorrect|wrong|exact)\b/.test(value)) {
      return {
        l2Driver: "Live tracking location accuracy issue",
        l1Driver: "Live Tracking Issue"
      };
    }

    if (/\b(slow|lag|lags|lagging|delay|delayed)\b/.test(value)) {
      return {
        l2Driver: "Live tracking delay issue",
        l1Driver: "Live Tracking Issue"
      };
    }

    return {
      l2Driver: "Live tracking not working issue",
      l1Driver: "Live Tracking Issue"
    };
  }

  if (hasNavigationContext(value)) {
    if (/\b(accurate|accuracy|inaccurate|incorrect|wrong|misleading)\b/.test(value)) {
      return {
        l2Driver: "Map or navigation accuracy issue",
        l1Driver: "Navigation Issue"
      };
    }

    if (/\b(slow|lag|lags|lagging|delay|delayed|late)\b/.test(value)) {
      return {
        l2Driver: "Map or navigation lag issue",
        l1Driver: "Navigation Issue"
      };
    }

    if (/\b(not working|failed|failure|error|unable|problem|issue)\b/.test(value)) {
      return {
        l2Driver: "Map or navigation not working issue",
        l1Driver: "Navigation Issue"
      };
    }

    return {
      l2Driver: "Map or navigation improvement request",
      l1Driver: "Navigation Issue"
    };
  }

  if (/\b(bluetooth|bt|pairing|paired)\b/.test(value)) {
    if (/\b(disconnect|disconnected|reconnect|auto reconnect)\b/.test(value)) {
      return {
        l2Driver: "Bluetooth disconnection issue",
        l1Driver: "Bluetooth Connectivity Issue"
      };
    }

    if (/\b(slow|delay|delayed|late)\b/.test(value)) {
      return {
        l2Driver: "Bluetooth connection delay issue",
        l1Driver: "Bluetooth Connectivity Issue"
      };
    }

    return {
      l2Driver: "Bluetooth pairing or connection issue",
      l1Driver: "Bluetooth Connectivity Issue"
    };
  }

  if (/\b(notification|notifications|alert|alerts|call alert|message alert|theft alert|crash alert|fall alert)\b/.test(value)) {
    if (/\bcrash\b/.test(value)) {
      if (
        /\b(false|wrong|incorrect|no crash|didn't crash|did not crash|without crash|accidental|mistaken|falsely)\b/.test(
          value
        )
      ) {
        return {
          l2Driver: "False crash alert notification issue",
          l1Driver: "Crash Alert Issue"
        };
      }

      return {
        l2Driver: "Crash alert notification issue",
        l1Driver: "Crash Alert Issue"
      };
    }

    if (/\btheft\b/.test(value)) {
      return {
        l2Driver: "Theft alert notification issue",
        l1Driver: "Theft Alert Issue"
      };
    }

    if (/\bfall\b/.test(value)) {
      return {
        l2Driver: "Fall alert notification issue",
        l1Driver: "Fall Alert Issue"
      };
    }

    if (/\b(call)\b/.test(value)) {
      return {
        l2Driver: "Call notification issue",
        l1Driver: "Notification Issue"
      };
    }

    if (/\b(message|sms)\b/.test(value)) {
      return {
        l2Driver: "Message notification issue",
        l1Driver: "Notification Issue"
      };
    }

    return {
      l2Driver: "Alert notification issue",
      l1Driver: "Notification Issue"
    };
  }

  if (/\b(login|log in|logged|logout|otp|password)\b/.test(value)) {
    if (/\b(otp)\b/.test(value)) {
      return {
        l2Driver: "OTP login issue",
        l1Driver: "Login Issue"
      };
    }

    return {
      l2Driver: "App login issue",
      l1Driver: "Login Issue"
    };
  }

  if (/\b(vehicle stats|vehicle data|real time|realtime|cluster|sync|charge history|charging history|trip)\b/.test(value)) {
    if (/\b(charge history|charging history)\b/.test(value)) {
      return {
        l2Driver: "Charging history data issue",
        l1Driver: "Data Sync Issue"
      };
    }

    if (/\b(trip)\b/.test(value)) {
      return {
        l2Driver: "Trip data update issue",
        l1Driver: "Data Sync Issue"
      };
    }

    if (/\b(cluster|sync)\b/.test(value)) {
      return {
        l2Driver: "App and cluster sync issue",
        l1Driver: "Data Sync Issue"
      };
    }

    if (/\b(slow|delay|delayed|late)\b/.test(value)) {
      return {
        l2Driver: "Real-time data update delay",
        l1Driver: "Data Sync Issue"
      };
    }

    return {
      l2Driver: "Vehicle data accuracy or display issue",
      l1Driver: "Data Sync Issue"
    };
  }

  if (/\b(public charging|charging station|charging location|charger location)\b/.test(value)) {
    return CHARGER_DRIVER;
  }

  if (/\b(battery|charging speed|mobile charging|phone charging)\b/.test(value)) {
    return {
      l2Driver: "Mobile battery drain while using app",
      l1Driver: "Battery Impact Issue"
    };
  }

  if (/\b(music|multi user|multiuser|additional feature|more feature|new feature|option|enable|disable|available|required)\b/.test(value)) {
    return {
      l2Driver: "Feature enhancement request",
      l1Driver: "Feature Gap"
    };
  }

  if (/\b(subscription|price|pricing|charge|cost|expensive|high)\b/.test(value)) {
    return {
      l2Driver: "Subscription pricing issue",
      l1Driver: "Subscription Issue"
    };
  }

  if (/\b(app|application|mobile app|smartxconnect|smart xonnect|connected feature|connected features)\b/.test(value)) {
    if (/\b(slow|lag|lags|lagging|delay|delayed)\b/.test(value)) {
      return {
        l2Driver: "Feature slow or lagging issue",
        l1Driver: "Performance Issue"
      };
    }

    if (/\b(not working|not functioning|failed|failure|error|unable|crash)\b/.test(value)) {
      return {
        l2Driver: "Feature not working issue",
        l1Driver: "Functionality Issue"
      };
    }

    if (/\b(interface|ui|screen|experience|poor|difficult)\b/.test(value)) {
      return {
        l2Driver: "Feature interface or experience issue",
        l1Driver: "Usability Issue"
      };
    }

    return {
      l2Driver: "Feature general issue",
      l1Driver: "Functionality Issue"
    };
  }

  return OTHERS_DRIVER;
}

export function resolveDriverHierarchy(
  params: DriverHierarchyInput
): DriverHierarchy {
  const contextText = [
    params.l3Driver,
    params.notes,
    params.topic,
    params.transcription,
    params.l2Driver,
    params.l1Driver
  ]
    .filter(Boolean)
    .join(" ");
  const normalizedContext = normalizeForMatch(contextText);
  const normalizedL3Driver = normalizeForMatch(params.l3Driver || "");
  const normalizedSentiment = normalizeForMatch(params.sentiment || "");
  const normalizedSpeaker = normalizeForMatch(params.speaker || "");
  const desiredStateIssue = hasDesiredStateIssue(normalizedContext);
  const hasExplicitIssue =
    Boolean(normalizedL3Driver) ||
    hasIssueSignal(normalizedContext) ||
    desiredStateIssue;

  if (
    !normalizedL3Driver ||
    !normalizedContext ||
    isAgentSpeaker(normalizedSpeaker) ||
    (!desiredStateIssue &&
      isPositiveOnlyFeedback(normalizedContext, normalizedSentiment)) ||
    !hasExplicitIssue
  ) {
    return { l2Driver: "", l1Driver: "" };
  }

  if (hasChargerIssueContext(normalizedContext)) {
    return CHARGER_DRIVER;
  }

  if (!hasConnectedFeatureContext(normalizedContext)) {
    if (hasVehicleIssueContext(normalizedContext)) {
      return VEHICLE_DRIVER;
    }

    return OTHERS_DRIVER;
  }

  return classifyConnectedFeatureIssue(normalizedContext);
}
