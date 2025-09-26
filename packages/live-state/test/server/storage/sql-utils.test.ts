import { describe, test, expect, beforeEach } from "vitest";
import { applyWhere } from "../../../src/server/storage/sql-utils";
import { createSchema, object, createRelations } from "../../../src/schema";
import {
  string,
  number,
  id,
  reference,
} from "../../../src/schema/atomic-types";
import {
  AndNode,
  BinaryOperationNode,
  ColumnNode,
  DummyDriver,
  Kysely,
  OperatorNode,
  ParensNode,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  PrimitiveValueListNode,
  ReferenceNode,
  SchemableIdentifierNode,
  SelectQueryBuilder,
  SelectQueryNode,
  TableNode,
  ValueNode,
} from "kysely";

/**
 * Comprehensive tests for the applyWhere function covering all WhereClause operations.
 *
 * NOTE: These tests are designed to fail initially since the current implementation
 * only supports basic field equality and relations. The tests cover the full expected
 * functionality including:
 * - Basic field equality
 * - Advanced operators ($eq, $in, $not, $gt, $gte, $lt, $lte)
 * - Logical operators ($and, $or)
 * - Relation-based queries
 * - Error cases and edge cases
 *
 * The tests use .compile() on Kysely query builders to inspect the generated SQL
 * and parameters without mocking Kysely internals.
 */
describe("applyWhere", () => {
  // Create test schema with users and posts using proper factory functions
  const User = object("users", {
    id: id(),
    name: string(),
    age: number(),
    email: string(),
  });

  const Post = object("posts", {
    id: id(),
    title: string(),
    content: string(),
    userId: reference("users.id"),
    views: number(),
  });

  // Create relations using the proper factory
  const userRelations = createRelations(User, ({ many }) => ({
    posts: many(Post, "userId"),
  }));

  const postRelations = createRelations(Post, ({ one }) => ({
    user: one(User, "userId", true),
  }));

  const schema = createSchema({
    User,
    Post,
    userRelations,
    postRelations,
  });

  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
  });
  let baseUserQuery: SelectQueryBuilder<any, any, any>;
  let basePostQuery: SelectQueryBuilder<any, any, any>;

  beforeEach(() => {
    // Create dummy db that just compiles queries
    baseUserQuery = db.selectFrom("users").selectAll("users");
    basePostQuery = db.selectFrom("posts").selectAll("posts");
  });

  test("should handle an empty where clause", () => {
    const result = applyWhere(schema, "users", baseUserQuery, {});
    const compiled = result.compile();
    const query = compiled.query as SelectQueryNode;

    // Verify query structure
    expect(query.kind).toEqual("SelectQueryNode");
    expect(query.where).toBeUndefined();

    // Verify compiled SQL has no WHERE clause
    expect(compiled.sql).not.toContain("where");
    expect(compiled.sql).not.toContain("WHERE");
  });

  describe("Basic field equality", () => {
    test("should handle simple field equality", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: "John",
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "="
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.value).toEqual("John");
    });

    test("should handle multiple field equalities", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: "John",
        age: 25,
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("ParensNode");
      expect((query.where?.where as ParensNode).node.kind).toEqual("AndNode");

      const andNode = (query.where?.where as ParensNode).node as AndNode;
      const first = andNode.left as BinaryOperationNode;
      const second = andNode.right as BinaryOperationNode;

      expect(first.kind).toEqual("BinaryOperationNode");
      expect(second.kind).toEqual("BinaryOperationNode");

      expect(first.operator.kind).toEqual("OperatorNode");
      expect(second.operator.kind).toEqual("OperatorNode");

      expect((first.operator as OperatorNode).operator).toEqual("=");
      expect((second.operator as OperatorNode).operator).toEqual("=");

      expect(first.leftOperand.kind).toEqual("ReferenceNode");
      expect(second.leftOperand.kind).toEqual("ReferenceNode");

      expect(first.rightOperand.kind).toEqual("ValueNode");
      expect(second.rightOperand.kind).toEqual("ValueNode");

      expect((first.leftOperand as ReferenceNode).column.kind).toEqual(
        "ColumnNode"
      );
      expect((second.leftOperand as ReferenceNode).column.kind).toEqual(
        "ColumnNode"
      );

      expect((first.rightOperand as ValueNode).value).toEqual("John");
      expect((second.rightOperand as ValueNode).value).toEqual(25);
    });

    test("should handle $eq operator", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: { $eq: "John" },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "="
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.value).toEqual("John");
    });

    test("should handle implicity $eq operator with null", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: null,
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "is"
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.value).toEqual(null);
    });

    test("should handle $eq operator with null", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: { $eq: null },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "is"
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.value).toEqual(null);
    });

    test("should handle $not operator with null", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: { $not: null },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "is not"
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.value).toEqual(null);
    });
  });

  describe("Advanced operators", () => {
    test("should handle $in operator", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: { $in: ["John", "Jane"] },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "in"
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual(
        "PrimitiveValueListNode"
      );

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode =
        binaryOperationNode.rightOperand as PrimitiveValueListNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.values).toEqual(["John", "Jane"]);
    });
  });

  describe("$not operators", () => {
    test("should handle $not operator short form", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: { $not: "John" },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "!="
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.value).toEqual("John");
    });

    test("should handle $not operator long form", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: { $not: { $eq: "John" } },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "!="
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.value).toEqual("John");
    });

    test("should handle $not operator long form with $in", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        name: { $not: { $in: ["John", "Jane"] } },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "not in"
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual(
        "PrimitiveValueListNode"
      );

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode =
        binaryOperationNode.rightOperand as PrimitiveValueListNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(valueNode.values).toEqual(["John", "Jane"]);
    });
  });

  describe("Comparison operators", () => {
    test("should handle $gt operator", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        age: { $gt: 25 },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        ">"
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("age");
      expect(valueNode.value).toEqual(25);
    });

    test("should handle $gte operator", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        age: { $gte: 25 },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        ">="
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("age");
      expect(valueNode.value).toEqual(25);
    });

    test("should handle $lt operator", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        age: { $lt: 25 },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "<"
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("age");
      expect(valueNode.value).toEqual(25);
    });

    test("should handle $lte operator", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        age: { $lte: 25 },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "<="
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("age");
      expect(valueNode.value).toEqual(25);
    });
  });

  describe("Relations", () => {
    test("should handle deep relations", () => {
      const result = applyWhere(schema, "posts", basePostQuery, {
        user: {
          name: "John Doe",
        },
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("BinaryOperationNode");

      const binaryOperationNode = query.where?.where as BinaryOperationNode;
      expect(binaryOperationNode.kind).toEqual("BinaryOperationNode");
      expect(binaryOperationNode.operator.kind).toEqual("OperatorNode");
      expect((binaryOperationNode.operator as OperatorNode).operator).toEqual(
        "="
      );
      expect(binaryOperationNode.leftOperand.kind).toEqual("ReferenceNode");
      expect(binaryOperationNode.rightOperand.kind).toEqual("ValueNode");

      const referenceNode = binaryOperationNode.leftOperand as ReferenceNode;
      const valueNode = binaryOperationNode.rightOperand as ValueNode;

      expect(referenceNode.column.kind).toEqual("ColumnNode");
      expect((referenceNode.column as ColumnNode).column.name).toEqual("name");
      expect(referenceNode.table?.kind).toEqual("TableNode");
      expect(
        ((referenceNode.table as TableNode).table as SchemableIdentifierNode)
          .identifier.name
      ).toEqual("users");
      expect(valueNode.value).toEqual("John Doe");

      expect(query.joins).toBeDefined();
      expect(query.joins?.length).toEqual(1);
      expect(query.joins?.[0].kind).toEqual("JoinNode");
      expect(query.joins?.[0].joinType).toEqual("LeftJoin");
      expect(
        ((query.joins?.[0].table as TableNode).table as SchemableIdentifierNode)
          .identifier.name
      ).toEqual("users");
      expect(query.joins?.[0].on?.kind).toEqual("OnNode");
      expect(query.joins?.[0].on?.on?.kind).toEqual("BinaryOperationNode");
      const on = query.joins?.[0].on?.on as BinaryOperationNode;
      expect(on.leftOperand?.kind).toEqual("ReferenceNode");
      expect(on.rightOperand?.kind).toEqual("ReferenceNode");
      const leftOperand = on.leftOperand as ReferenceNode;
      const rightOperand = on.rightOperand as ReferenceNode;
      expect(leftOperand.column?.kind).toEqual("ColumnNode");
      expect(rightOperand.column?.kind).toEqual("ColumnNode");
      expect(leftOperand.table?.kind).toEqual("TableNode");
      expect(rightOperand.table?.kind).toEqual("TableNode");
      expect(
        ((leftOperand.table as TableNode).table as SchemableIdentifierNode)
          .identifier.name
      ).toEqual("users");
      expect(
        ((rightOperand.table as TableNode).table as SchemableIdentifierNode)
          .identifier.name
      ).toEqual("posts");
      expect(leftOperand.column?.kind).toEqual("ColumnNode");
      expect(rightOperand.column?.kind).toEqual("ColumnNode");
      expect((leftOperand.column as ColumnNode).column.name).toEqual("id");
      expect((rightOperand.column as ColumnNode).column.name).toEqual("userId");
    });
  });

  describe("$and and $or operators", () => {
    test("should handle $and operator", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        $and: [{ name: "John" }, { age: { $gt: 25 } }],
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("ParensNode");
      expect((query.where?.where as ParensNode).node.kind).toEqual("AndNode");

      const andNode = (query.where?.where as ParensNode).node as AndNode;
      const first = andNode.left as BinaryOperationNode;
      const second = andNode.right as BinaryOperationNode;

      expect(first.kind).toEqual("BinaryOperationNode");
      expect(second.kind).toEqual("BinaryOperationNode");

      expect(first.operator.kind).toEqual("OperatorNode");
      expect(second.operator.kind).toEqual("OperatorNode");

      expect((first.operator as OperatorNode).operator).toEqual("=");
      expect((second.operator as OperatorNode).operator).toEqual(">");

      expect(first.leftOperand.kind).toEqual("ReferenceNode");
      expect(second.leftOperand.kind).toEqual("ReferenceNode");

      expect(first.rightOperand.kind).toEqual("ValueNode");
      expect(second.rightOperand.kind).toEqual("ValueNode");

      expect((first.leftOperand as ReferenceNode).column.kind).toEqual(
        "ColumnNode"
      );
      expect((second.leftOperand as ReferenceNode).column.kind).toEqual(
        "ColumnNode"
      );

      expect((first.rightOperand as ValueNode).value).toEqual("John");
      expect((second.rightOperand as ValueNode).value).toEqual(25);
    });

    test("should handle $or operator", () => {
      const result = applyWhere(schema, "users", baseUserQuery, {
        $or: [{ name: "John" }, { age: { $gt: 25 } }],
      });
      const compiled = result.compile();
      const query = compiled.query as SelectQueryNode;

      // Verify query structure
      expect(query.kind).toEqual("SelectQueryNode");
      expect(query.where).toBeDefined();
      expect(query.where?.where.kind).toEqual("ParensNode");
      expect((query.where?.where as ParensNode).node.kind).toEqual("OrNode");

      const orNode = (query.where?.where as ParensNode).node as OrNode;
      const first = orNode.left as BinaryOperationNode;
      const second = orNode.right as BinaryOperationNode;

      expect(first.kind).toEqual("BinaryOperationNode");
      expect(second.kind).toEqual("BinaryOperationNode");

      expect(first.operator.kind).toEqual("OperatorNode");
      expect(second.operator.kind).toEqual("OperatorNode");

      expect((first.operator as OperatorNode).operator).toEqual("=");
      expect((second.operator as OperatorNode).operator).toEqual(">");

      expect(first.leftOperand.kind).toEqual("ReferenceNode");
      expect(second.leftOperand.kind).toEqual("ReferenceNode");

      expect(first.rightOperand.kind).toEqual("ValueNode");
      expect(second.rightOperand.kind).toEqual("ValueNode");

      expect((first.leftOperand as ReferenceNode).column.kind).toEqual(
        "ColumnNode"
      );
      expect((second.leftOperand as ReferenceNode).column.kind).toEqual(
        "ColumnNode"
      );

      expect((first.rightOperand as ValueNode).value).toEqual("John");
      expect((second.rightOperand as ValueNode).value).toEqual(25);
    });
  });
});
