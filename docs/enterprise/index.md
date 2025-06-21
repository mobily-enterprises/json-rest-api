---
layout: default
title: Enterprise Features
---

# Enterprise Features for JSON REST API

Welcome to the enterprise section of JSON REST API. These advanced patterns and plugins are designed for large teams building complex, distributed systems.

## 📚 Enterprise Patterns

### [Microservices Architecture](./GUIDE_8_Microservices.md)
Build distributed systems with multiple transport layers (TCP, Redis, NATS, RabbitMQ, Kafka, gRPC). Includes service discovery, circuit breakers, and health checks.

### [CQRS Pattern](./GUIDE_9_CQRS.md) 
Implement Command Query Responsibility Segregation with event sourcing, projections, and sagas. Perfect for high-performance, event-driven architectures.

### [Domain-Driven Design](./GUIDE_11_Domain_Driven_Design.md)
Full DDD implementation with value objects, entities, aggregates, repositories, and specifications. Build complex business logic with clear boundaries.

## 🏢 Enterprise Governance

### [Enterprise Architecture Guide](./ENTERPRISE_GUIDE.md)
Comprehensive guide covering:
- **Architecture Enforcement** - Enforce naming conventions, required plugins, and patterns
- **Dependency Management** - Visualize and manage complex resource relationships
- **Bounded Contexts** - Implement DDD context boundaries with anti-corruption layers
- **Migration Strategies** - Move from monoliths to microservices
- **Training Materials** - Workshop content for enterprise teams

## 🚀 Getting Started

1. **New to enterprise patterns?** Start with the [Enterprise Architecture Guide](./ENTERPRISE_GUIDE.md)
2. **Building microservices?** See [Microservices Architecture](./GUIDE_8_Microservices.md)
3. **Need event sourcing?** Check out [CQRS Pattern](./GUIDE_9_CQRS.md)
4. **Complex domain logic?** Implement [Domain-Driven Design](./GUIDE_11_Domain_Driven_Design.md)

## 📦 Enterprise Plugins

All enterprise plugins are available from the main package:

```javascript
import { 
  MicroservicesPlugin,
  CQRSPlugin,
  DDDPlugin,
  BoundedContextPlugin,
  ArchitectureEnforcementPlugin,
  DependencyGraphPlugin
} from 'json-rest-api'
```

## 🔗 Quick Links

- [Back to Main Guide](../GUIDE.md)
- [API Reference](../API.md)
- [Examples](../examples/)
- [GitHub Repository](https://github.com/mobily-enterprises/json-rest-api)