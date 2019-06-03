const MAX_PLANLIST_SIZE = 15;

function getRecommendList(nowDate, callback) {
  let urlOData = Common.getAppCellUrl() + "__/OData/EventList";
  let startMoment = moment(nowDate).startOf("day").add(8,"hour");
  let endMoment = moment(nowDate).endOf("day");
  let query = {
    "$top": 1000,
    "$filter": "startDate gt datetimeoffset'"+startMoment.toISOString()+"' and startDate le datetimeoffset'"+endMoment.toISOString()+"'",
    "$orderby": "startDate asc, endDate desc"
  }
  
  let queryStr = $.param(query);
  let queryUrl = urlOData + "?" + queryStr;
  // Get plan list and list under consideration
  $.when(
    getAPI(queryUrl, Common.getToken()),
    getPlanningAPI(),
    getMyDataAPI('interests.json')
  ).done(function(planObj, planningObj, myInterests) {
    // TODO Handle Error Response
    let planList = planObj[0].d.results;
    let planningList = planningObj[0].d.results;
    const myKeywords = myInterests[0].keywords;
    if (!_.isUndefined(myKeywords)) {
      sessionStorage.keywords = JSON.stringify(myKeywords);
    }
    // List of plans being considered / participated on the relevant day
    let todayPlanningList = [];
    // Merge the acquired list
    _.each(planList, function(plan, i, list) {
      plan.type = "event";
      _.every(planningList, function(planning) {
        if (plan.__id == planning.event_id) {
          plan.planStatus = planning.planStatus;
          todayPlanningList.push(plan);
          return false;
        }
        return true;
      })
    })

    // Create reccomend event
    let recommendSchedule = [];

    // Calendar linkage
    let cSchedule = {
      "allday": [],
      "oneday": []
    };
    getPCalendarSchedule(startMoment.format("YYYY-MM-DD")).done(function(schedule) {
      cSchedule = schedule;
    }).fail(function(e) {
      console.log(e);
    }).always(function() {
      // calendar:allday
      if (cSchedule.allday.length > 0) {
        $("#recommended-schedule").addClass("mask-event");
        recommendSchedule.push({
          "type": "allday",
          "title": cSchedule.allday,
        })
      }

      // home
      recommendSchedule.push({
          "type": "home",
          "planStatus": "confirm",
          "title": "自宅",
          "startDate": startMoment.toISOString(),
          "endDate": moment(startMoment).add(30, "minutes").toISOString(),
          "longitude": 9999, // Interim
          "latitude": 9999 // Interim
      });

      // calendar:oneday
      recommendSchedule = setRecommendSchedule(recommendSchedule, cSchedule.oneday);

      // Review / Participation
      recommendSchedule = setRecommendSchedule(recommendSchedule, todayPlanningList);
      
      // Recommended plan list using my keywords
      const recommendedPlanList = createRecommendedList(planList, myKeywords, MAX_PLANLIST_SIZE);
      recommendSchedule = setRecommendSchedule(recommendSchedule, recommendedPlanList);

      // Other
      const sampledPlanList = _.sample(filterByContent(planList), MAX_PLANLIST_SIZE);
      recommendSchedule = setRecommendSchedule(recommendSchedule, sampledPlanList);
      
      let lastHomeEndMoment = moment(recommendSchedule[recommendSchedule.length - 1].endDate);
      let homePlan = {
          "type": "home",
          "planStatus": "confirm",
          "title": "自宅",
          "startDate": lastHomeEndMoment.toISOString(),
          "longitude": 9999, // Interim
          "latitude": 9999 // Interim
      }
      let sectionEvent = getSection();
      let resultIndex = checkLonLat(recommendSchedule, homePlan, recommendSchedule.length - 1);
      if (resultIndex != null) {
        homePlan.startDate = lastHomeEndMoment.add(
            getTravelTime(
              recommendSchedule[resultIndex].longitude
            , recommendSchedule[resultIndex].latitude
            , homePlan.longitude
            , homePlan.latitude
            )
          , "minutes"
        ).toISOString();
        sectionEvent = getMove(homePlan, recommendSchedule[resultIndex]);
      }
      recommendSchedule.push(sectionEvent);
      recommendSchedule.push(homePlan);
  
      if ((typeof callback !== "undefined") && $.isFunction(callback)) {
        callback(recommendSchedule);
      }
    })
  }).fail(function(e) {
    console.log(e);
  })
}

// Add the corresponding event to the schedule list
function setRecommendSchedule(resultList, list) {
  let result = resultList;
  _.each(list, function(plan, i, p_list) {
    // Check if it is already registered
    let grepList = $.grep(result, function(elem, index){return (elem.__id == plan.__id)});
    if (grepList.length <= 0) {
      // Get Start date and time of Scheduled Registration Event
      let planStartMoment = moment(plan.startDate);
      // Get the end date and time of scheduled registration event
      let planEndMoment = moment(plan.endDate);
      let tempPrevCnt = 0;
      let tempPrevRes = null;
      let resCnt = 0;
      let pushCnt = -1;
      let skipFlg = false;
      // Search current schedule list
      _.every(result, function(res) {
        // Ignore events that do not have an end date because they are out of scope events such as move
        if (res.endDate) {
          // Get start date and time of scheduled event
          let resStartMoment = moment(res.startDate);
          let tempPlanEndMoment = moment(planEndMoment);
          if (res.longitude && res.latitude) {
            // Calculate travel time if latitude / longitude is registered to the next event of the event to be inserted
            let lon = plan.longitude;
            let lat = plan.latitude;
            if (!lon || !lat) {
              // If there is no latitude / longitude in the event to be inserted, use the previous latitude / longitude
              for (var i = tempPrevCnt; i >= 0; i--) {
                if (result[i].longitude && result[i].latitude) {
                  lon = result[i].longitude;
                  lat = result[i].latitude;
                  break;
                }
              }
            }
            // Get travel time (minutes)
            let addMinutes = getTravelTime(res.longitude, res.latitude, lon, lat);
            tempPlanEndMoment = moment(planEndMoment).add(addMinutes, "minutes");
          }
          if (resStartMoment.isSameOrAfter(tempPlanEndMoment)) {
            if (tempPrevRes) {
              let prevResEndMoment = moment(tempPrevRes.endDate);
              if (plan.longitude && plan.latitude) {
                // Calculate the travel time if latitude / longitude is registered for the event to be inserted
                let prevLonLatIndex = tempPrevCnt;
                // Get last latitude and longitude
                for (var i = tempPrevCnt; i >= 0; i--) {
                  if (result[i].longitude && result[i].latitude) {
                    prevLonLatIndex = i;
                    break;
                  }
                }
                let addMinutes = getTravelTime(result[prevLonLatIndex].longitude, result[prevLonLatIndex].latitude, plan.longitude, plan.latitude);
                prevResEndMoment = moment(tempPrevRes.endDate).add(addMinutes, "minutes");
              }
              if (prevResEndMoment.isSameOrBefore(planStartMoment)) {
                // Add an event if time is available to insert in the schedule list
                pushCnt = resCnt;
              } else {
                // Skip registration if there is not enough time to insert
                skipFlg = true;
              }
            } else {
              // Add to the schedule list if it is after the last event in the current schedule list
              pushCnt = resCnt;
            }
            return false;
          }
  
          tempPrevCnt = resCnt;
          tempPrevRes = res;
        }
        resCnt++;    
        return true;
      })
      if (!skipFlg) {
        if (pushCnt >= 0) {
          // Add an event at the end of the schedule
          if (result[pushCnt - 1] && (result[pushCnt - 1].type == "transportation" || result[pushCnt - 1].type == "section")) {
            pushCnt--;
          }
          let sectionEvent = getSection();
          let resultIndex = checkLonLat(result, plan, pushCnt);
          if (resultIndex != null) {
            sectionEvent = getMove(plan, result[resultIndex]);
          }
          result.splice(pushCnt, 0, plan);
          result.splice(pushCnt, 0, sectionEvent);
        } else {
          let addMinutes = 0;
          // Insert an event
          let sectionEvent = getSection();
          let resultIndex = checkLonLat(result, plan, result.length - 1);
          if (resultIndex != null) {
            sectionEvent = getMove(plan, result[resultIndex]);
            addMinutes = getTravelTime(result[resultIndex].longitude, result[resultIndex].latitude, plan.longitude, plan.latitude);
          }

          if (tempPrevRes && moment(tempPrevRes.endDate).add(addMinutes, "minutes").isSameOrBefore(planStartMoment)) {
            result.push(plan);
            result.splice(result.length - 1, 0, sectionEvent);
          }
        }
      }
    }
  })

  return result;
}

/**
 * Find moving time from start point to end point(minutes)
 * (Unmounted: fixed for 30 minutes)
 */
function getTravelTime(stLon, stLat, edLon, edLat) {
  return 30;
}

/**
 * Find moving distance from start point to end point (minutes)
 * (Unmounted: fixed for 300M)
 */
function getTravelDistance(stLon, stLat, edLon, edLat) {
  return "約300M";
}

/**
 * Check the latitude and longitude of the event to determine the need for travel time
 */
function checkLonLat(resultList, plan, index) {
  if (!resultList[index]) {
    return null;
  }

  if (!plan.longitude || !plan.latitude) {
    return null;
  }

  let moveTargetIndex = null;
  for (var i = index; i >= 0; i--) {
    if (resultList[i].longitude && resultList[i].latitude) {
      if (resultList[i].longitude != plan.longitude 
        || resultList[i].latitude != plan.latitude) {
        moveTargetIndex = i;
      }
      break;
    }
  }

  return moveTargetIndex;
}

function getSection() {
  return {
    "type": "section"
  };
}

/*
 * Calculate movement distance between events from latitude and longitude and return movement event
 * TODO:Currently not implemented
 */
function getMove(plan, resultPlan) {
  return {
    "type": "transportation",
    "title": "移動",
    "distance": getTravelDistance(
                resultPlan.longitude
              , resultPlan.latitude
              , plan.longitude
              , plan.latitude
            )
  };
}

// Calendar event acquisition API
function getPCalendarSchedule(targetDay) {
  let temp = {
    p_target: Common.getCellUrl(),
    refToken: Common.getRefressToken(),
    targetDay: targetDay
  }
  return $.ajax({
    type: "POST",
    url: Common.getAppCellUrl() + "__/html/Engine/getPCalendarSchedule",
    data: temp,
    headers: {
      'Accept':'application/json',
      'Authorization':'Bearer ' + Common.getToken()
    }
  })
}