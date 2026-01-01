/**
 * Property Scoring Service
 * 
 * Calculates property scores based on threshold ranges.
 * Uses the Multifamily Rating Scale methodology from the Excel scorecard.
 * 
 * Score Logic:
 * - "Higher is better" factors: if Figure >= threshold → get that score
 * - "Lower is better" factors: if Figure <= threshold → get that score
 */

// Default scorecard configuration with threshold-based scoring
// Each factor has thresholds for scores 10 through 1
const DEFAULT_SCORECARD_CONFIG = {
  factors: {
    population: {
      name: 'Population',
      weight: 0.075, // 7.5%
      dataPath: 'demographics.population_3mile',
      lowerIsBetter: false,
      // Thresholds: score → minimum value to achieve that score
      thresholds: {
        10: 70000,
        9: 65000,
        8: 60000,
        7: 55000,
        6: 50000,
        5: 45000,
        4: 40000,
        3: 35000,
        2: 30000,
        1: 25000,
      },
    },
    populationGrowth: {
      name: 'Population Growth',
      weight: 0.10, // 10%
      dataPath: 'demographics.population_growth_3mile',
      lowerIsBetter: false,
      thresholds: {
        10: 0.0100, // 1.00%
        9: 0.0075,  // 0.75%
        8: 0.0050,  // 0.50%
        7: 0.0025,  // 0.25%
        6: 0.0000,  // 0.00%
        5: -0.0025, // -0.25%
        4: -0.0050, // -0.50%
        3: -0.0075, // -0.75%
        2: -0.0100, // -1.00%
        1: -0.0125, // -1.25%
      },
    },
    medianHHIncome: {
      name: 'Median HH Income',
      weight: 0.10, // 10%
      dataPath: 'demographics.median_hh_income_3mile',
      lowerIsBetter: false,
      thresholds: {
        10: 70000,
        9: 65000,
        8: 60000,
        7: 55000,
        6: 50000,
        5: 45000,
        4: 40000,
        3: 35000,
        2: 30000,
        1: 25000,
      },
    },
    medianHomeValue: {
      name: 'Median Home Value',
      weight: 0.075, // 7.5%
      dataPath: 'demographics.median_home_value_3mile',
      lowerIsBetter: false,
      thresholds: {
        10: 525000,
        9: 475000,
        8: 425000,
        7: 375000,
        6: 325000,
        5: 275000,
        4: 225000,
        3: 175000,
        2: 125000,
        1: 75000,
      },
    },
    renterHouseholdsPercent: {
      name: 'Renter Households %',
      weight: 0.05, // 5%
      dataPath: 'demographics.renter_households_pct_3mile',
      lowerIsBetter: false,
      thresholds: {
        10: 0.50, // 50%
        9: 0.45,  // 45%
        8: 0.40,  // 40%
        7: 0.35,  // 35%
        6: 0.30,  // 30%
        5: 0.25,  // 25%
        4: 0.20,  // 20%
        3: 0.15,  // 15%
        2: 0.10,  // 10%
        1: 0.05,  // 5%
      },
    },
    violentCrimeRate: {
      name: 'Violent Crime Rate',
      weight: 0.05, // 5%
      dataPath: 'external.crime.violent_crime_index',
      lowerIsBetter: true, // Lower crime is better
      thresholds: {
        10: 20.0,
        9: 25.0,
        8: 30.0,
        7: 35.0,
        6: 40.0,
        5: 45.0,
        4: 50.0,
        3: 55.0,
        2: 60.0,
        1: 65.0,
      },
    },
    propertyCrimeRate: {
      name: 'Property Crime Rate',
      weight: 0.05, // 5%
      dataPath: 'external.crime.property_crime_index',
      lowerIsBetter: true, // Lower crime is better
      thresholds: {
        10: 30.0,
        9: 35.0,
        8: 40.0,
        7: 45.0,
        6: 50.0,
        5: 55.0,
        4: 60.0,
        3: 65.0,
        2: 70.0,
        1: 75.0,
      },
    },
    schoolRatings: {
      name: 'School Ratings',
      weight: 0.075, // 7.5%
      dataPath: 'external.schools.average_rating',
      lowerIsBetter: false,
      thresholds: {
        10: 9.0,
        9: 8.0,
        8: 7.0,
        7: 6.0,
        6: 5.0,
        5: 4.0,
        4: 3.0,
        3: 2.0,
        2: 1.0,
        1: 0.0,
      },
    },
    walkScore: {
      name: 'Walk Score',
      weight: 0.075, // 7.5%
      dataPath: 'external.walkScore.walk_score',
      lowerIsBetter: false,
      thresholds: {
        10: 80,
        9: 70,
        8: 60,
        7: 50,
        6: 40,
        5: 30,
        4: 20,
        3: 10,
        2: 5,
        1: 0,
      },
    },
    transitScore: {
      name: 'Transit Score',
      weight: 0.075, // 7.5%
      dataPath: 'external.walkScore.transit_score',
      lowerIsBetter: false,
      thresholds: {
        10: 80,
        9: 70,
        8: 60,
        7: 50,
        6: 40,
        5: 30,
        4: 20,
        3: 10,
        2: 5,
        1: 0,
      },
    },
    submarketVacancy: {
      name: 'Submarket Vacancy',
      weight: 0.10, // 10%
      dataPath: 'submarket.vacancy_rate',
      lowerIsBetter: true, // Lower vacancy is better
      thresholds: {
        10: 0.060, // 6.0%
        9: 0.070,  // 7.0%
        8: 0.080,  // 8.0%
        7: 0.090,  // 9.0%
        6: 0.100,  // 10.0%
        5: 0.110,  // 11.0%
        4: 0.120,  // 12.0%
        3: 0.130,  // 13.0%
        2: 0.140,  // 14.0%
        1: 0.150,  // 15.0%
      },
    },
    submarketDeliveredPercent: {
      name: 'Submarket Delivered % of Inventory',
      weight: 0.10, // 10%
      dataPath: 'submarket.delivered_pct_of_inventory',
      lowerIsBetter: false, // Higher delivery indicates strong market
      thresholds: {
        10: 0.025, // 2.5%
        9: 0.030,  // 3.0%
        8: 0.035,  // 3.5%
        7: 0.040,  // 4.0%
        6: 0.045,  // 4.5%
        5: 0.050,  // 5.0%
        4: 0.055,  // 5.5%
        3: 0.060,  // 6.0%
        2: 0.065,  // 6.5%
        1: 0.070,  // 7.0%
      },
    },
    submarketConstructionPercent: {
      name: 'Submarket Construction % of Inventory',
      weight: 0.075, // 7.5%
      dataPath: 'submarket.construction_pct_of_inventory',
      lowerIsBetter: true, // Lower construction means less competition
      thresholds: {
        10: 0.025, // 2.5%
        9: 0.030,  // 3.0%
        8: 0.035,  // 3.5%
        7: 0.040,  // 4.0%
        6: 0.045,  // 4.5%
        5: 0.050,  // 5.0%
        4: 0.055,  // 5.5%
        3: 0.060,  // 6.0%
        2: 0.065,  // 6.5%
        1: 0.070,  // 7.0%
      },
    },
  },

  // Decision thresholds
  thresholds: {
    moveForward: 7.0,      // Score >= 7.0 = Move Forward
    quickCheck: 5.5,       // Score >= 5.5 = Needs Review
    dontMoveForward: 0,    // Score < 5.5 = Rejected
  },
};

/**
 * ScoringService - Calculates property scores using threshold-based scoring
 */
class ScoringService {
  constructor(config = null) {
    this.config = config || JSON.parse(JSON.stringify(DEFAULT_SCORECARD_CONFIG));
  }

  /**
   * Update the scorecard configuration.
   */
  updateConfig(newConfig) {
    if (newConfig.factors) {
      for (const [key, value] of Object.entries(newConfig.factors)) {
        if (this.config.factors[key]) {
          this.config.factors[key] = { ...this.config.factors[key], ...value };
        }
      }
    }
    if (newConfig.thresholds) {
      this.config.thresholds = { ...this.config.thresholds, ...newConfig.thresholds };
    }
  }

  /**
   * Get value from nested object path.
   */
  _getValueByPath(obj, path) {
    if (!obj || !path) return null;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
      if (current === null || current === undefined) return null;
      current = current[part];
    }
    return current;
  }

  /**
   * Calculate score for a single factor using threshold comparison.
   * 
   * For "higher is better": Find highest score where value >= threshold
   * For "lower is better": Find highest score where value <= threshold
   */
  _calculateFactorScore(value, factorConfig) {
    if (value === null || value === undefined || isNaN(value)) {
      return {
        score: 0,
        rawValue: null,
        calculation: 'No data available',
      };
    }

    const thresholds = factorConfig.thresholds;
    const lowerIsBetter = factorConfig.lowerIsBetter || false;
    
    // #region agent log
    // DEBUG: Log factor scoring details for delivered % investigation
    if (factorConfig.name && factorConfig.name.includes('Delivered')) {
      fetch('http://127.0.0.1:7243/ingest/989934bd-196c-4f27-8680-9983681d066e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'scoring_service.js:_calculateFactorScore',message:'Delivered % factor scoring',data:{factorName:factorConfig.name,rawValue:value,lowerIsBetter:lowerIsBetter,thresholds:thresholds},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,B,C'})}).catch(()=>{});
    }
    // #endregion
    
    // Check scores from 10 down to 1
    for (let score = 10; score >= 1; score--) {
      const threshold = thresholds[score];
      if (threshold === undefined) continue;
      
      if (lowerIsBetter) {
        // Lower is better: value must be <= threshold to get this score
        if (value <= threshold) {
          // #region agent log
          if (factorConfig.name && factorConfig.name.includes('Delivered')) {
            fetch('http://127.0.0.1:7243/ingest/989934bd-196c-4f27-8680-9983681d066e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'scoring_service.js:lowerIsBetter-match',message:'Score matched (lower is better)',data:{factorName:factorConfig.name,value:value,threshold:threshold,score:score,comparison:`${value} <= ${threshold}`},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,D'})}).catch(()=>{});
          }
          // #endregion
          return {
            score,
            rawValue: value,
            calculation: `${value} <= ${threshold} (threshold for ${score})`,
          };
        }
      } else {
        // Higher is better: value must be >= threshold to get this score
        if (value >= threshold) {
          // #region agent log
          if (factorConfig.name && factorConfig.name.includes('Delivered')) {
            fetch('http://127.0.0.1:7243/ingest/989934bd-196c-4f27-8680-9983681d066e',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({location:'scoring_service.js:higherIsBetter-match',message:'Score matched (higher is better)',data:{factorName:factorConfig.name,value:value,threshold:threshold,score:score,comparison:`${value} >= ${threshold}`},timestamp:Date.now(),sessionId:'debug-session',hypothesisId:'A,D'})}).catch(()=>{});
          }
          // #endregion
          return {
            score,
            rawValue: value,
            calculation: `${value} >= ${threshold} (threshold for ${score})`,
          };
        }
      }
    }

    // Value didn't meet any threshold
    return {
      score: 0,
      rawValue: value,
      calculation: `${value} did not meet minimum threshold`,
    };
  }

  /**
   * Calculate weighted score for a property.
   */
  calculateScore(propertyData) {
    const breakdown = {};
    let totalWeightedScore = 0;
    let totalWeight = 0;

    // Calculate score for each factor
    for (const [factorKey, factorConfig] of Object.entries(this.config.factors)) {
      const rawValue = this._getValueByPath(propertyData, factorConfig.dataPath);
      const factorResult = this._calculateFactorScore(rawValue, factorConfig);
      
      
      const weightedScore = factorResult.score * factorConfig.weight;
      totalWeightedScore += weightedScore;
      totalWeight += factorConfig.weight;

      breakdown[factorKey] = {
        name: factorConfig.name,
        rawValue: factorResult.rawValue,
        score: factorResult.score,
        weight: factorConfig.weight,
        weightedScore: Math.round(weightedScore * 1000) / 1000,
        calculation: factorResult.calculation,
        lowerIsBetter: factorConfig.lowerIsBetter || false,
      };
    }

    // Total score is the weighted sum of (score × weight)
    // Since scores are 0-10 and weights sum to 1.0, totalWeightedScore IS the final score
    // Example: (10 × 0.075) + (4 × 0.10) + ... = 7.13
    const normalizedScore = Math.round(totalWeightedScore * 100) / 100;

    // Determine decision based on thresholds
    let decision;
    let decisionColor;
    if (normalizedScore >= this.config.thresholds.moveForward) {
      decision = 'Move Forward';
      decisionColor = 'green';
    } else if (normalizedScore >= this.config.thresholds.quickCheck) {
      decision = 'Needs Review';
      decisionColor = 'yellow';
    } else {
      decision = 'Rejected';
      decisionColor = 'red';
    }

    return {
      score: normalizedScore,
      decision,
      decisionColor,
      breakdown,
      thresholds: this.config.thresholds,
      calculatedAt: new Date().toISOString(),
    };
  }

  /**
   * Calculate scores for multiple properties.
   */
  calculateBatchScores(properties) {
    return properties.map(property => ({
      propertyId: property.id || property.propertyName,
      propertyName: property.propertyName || property.address?.propertyName,
      address: property.address,
      ...this.calculateScore(property),
    }));
  }

  /**
   * Re-run scoring with new configuration.
   */
  recalculateWithConfig(propertyData, newConfig) {
    this.updateConfig(newConfig);
    return this.calculateScore(propertyData);
  }

  /**
   * Get the current configuration.
   */
  getConfig() {
    return JSON.parse(JSON.stringify(this.config));
  }

  /**
   * Reset to default configuration.
   */
  resetToDefaults() {
    this.config = JSON.parse(JSON.stringify(DEFAULT_SCORECARD_CONFIG));
  }

  /**
   * Validate configuration has proper weights summing to 1.0.
   */
  validateConfig(config = this.config) {
    const factors = config.factors || {};
    let totalWeight = 0;

    for (const factor of Object.values(factors)) {
      totalWeight += factor.weight || 0;
    }

    const isValid = Math.abs(totalWeight - 1.0) < 0.001;

    return {
      valid: isValid,
      totalWeight: Math.round(totalWeight * 1000) / 1000,
      message: isValid 
        ? 'Configuration is valid' 
        : `Weights sum to ${totalWeight.toFixed(3)}, should sum to 1.0`,
    };
  }

  /**
   * Get summary statistics for a set of scored properties.
   */
  getSummaryStatistics(scoredProperties) {
    if (!scoredProperties || scoredProperties.length === 0) {
      return { count: 0, moveForward: 0, quickCheck: 0, dontMove: 0 };
    }

    const stats = {
      count: scoredProperties.length,
      moveForward: 0,
      quickCheck: 0,
      dontMove: 0,
      averageScore: 0,
      minScore: Infinity,
      maxScore: -Infinity,
      scores: [],
    };

    for (const prop of scoredProperties) {
      const score = prop.score || 0;
      stats.scores.push(score);
      stats.averageScore += score;

      if (score < stats.minScore) stats.minScore = score;
      if (score > stats.maxScore) stats.maxScore = score;

      if (score >= this.config.thresholds.moveForward) {
        stats.moveForward++;
      } else if (score >= this.config.thresholds.quickCheck) {
        stats.quickCheck++;
      } else {
        stats.dontMove++;
      }
    }

    stats.averageScore = Math.round((stats.averageScore / stats.count) * 100) / 100;

    return stats;
  }
}

export { ScoringService, DEFAULT_SCORECARD_CONFIG };
